/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./apps/**/*.{html,ts}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Inter", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
