/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F5EFE4",
        ink: "#1A1614",
        rust: "#C44536",
        mustard: "#E8A838",
        sage: "#6B8F71",
        cream: "#FAF4E8",
      },
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        chunky: "6px 6px 0 0 #1A1614",
        chunkyHover: "8px 8px 0 0 #1A1614",
        chunkyPress: "2px 2px 0 0 #1A1614",
        soft: "4px 4px 0 0 #1A1614",
      },
    },
  },
  plugins: [],
};
