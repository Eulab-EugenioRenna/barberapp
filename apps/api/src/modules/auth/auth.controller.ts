import { AuthResponse, ConnectAuthService } from "./connect-auth.service";
import { LoginDto, LoginEmailDto, SignupDto, RefreshDto } from "./auth.dto";
import {
  createLocalSession,
  rotateLocalSession,
  revokeLocalSession,
} from "../../common/local-sessions";
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { compare } from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";
import {
  resolveRequestSession,
  requireUser,
} from "../../common/request-session";
import { connectBrowser, ConnectRequest } from "../../common/connect-http";
import { bearerToken, tokenHash } from "../../common/local-sessions";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connect: ConnectAuthService,
  ) {}

  // Deliberately uniform: email-only discovery is not proof of an account or of its migration state.
  @Post("method")
  method(@Body() _body: LoginEmailDto): { connect: boolean } {
    return { connect: false };
  }

  @Post("login")
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: AuthResponse,
    @Req() request: ConnectRequest,
  ): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      include: { tenant: { select: { isActive: true, isSuspended: true } } },
    });
    // EULAB platform administration is separate from tenant access and cannot open the business APIs.
    if (user?.role === "platform_admin") {
      if (
        !user.isActive ||
        !(await compare(body.password ?? "", user.passwordHash))
      )
        throw new UnauthorizedException("Email o password non corretti");
      return this.prisma.$transaction((tx) => createLocalSession(tx, user.id));
    }
    if (
      user &&
      (!user.isActive || !user.tenant?.isActive || user.tenant.isSuspended)
    )
      throw new ForbiddenException("Accesso sospeso");

    return this.connect.signIn(body, request, response);
  }

  @Post("signup")
  signup(@Body() body: SignupDto, @Req() request: ConnectRequest) {
    return this.connect.signup(body, request);
  }

  @Post("refresh")
  async refresh(@Body() body: RefreshDto, @Req() request: ConnectRequest) {
    const current = await this.prisma.localSession.findUnique({
      where: { refreshHash: tokenHash(body.refreshToken) },
      select: { connectSessionId: true },
    });
    if (current?.connectSessionId) connectBrowser(request);
    return rotateLocalSession(this.prisma, body.refreshToken);
  }

  @Post("logout")
  async logout(
    @Req() request: ConnectRequest,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    const token = bearerToken(request.headers.authorization);
    const local = token
      ? await this.prisma.localSession.findUnique({
          where: { accessHash: tokenHash(token) },
          select: { connectSessionId: true },
        })
      : null;
    if (local?.connectSessionId) connectBrowser(request);
    await revokeLocalSession(this.prisma, request.headers.authorization);
    const provider = local?.connectSessionId
      ? await this.connect
          .logoutProvider(request.headers.authorization, request, response)
          .catch(() => ({ providerRevoked: false }))
      : { providerRevoked: null };
    return { ok: true, ...provider };
  }

  @Get("me")
  async me(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const user = requireUser(session);

    return user;
  }
}
