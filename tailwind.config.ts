import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Quota Compass Metric Colors
        strain: {
          DEFAULT: "hsl(var(--strain))",
          glow: "hsl(var(--strain-glow))",
        },
        recovery: {
          DEFAULT: "hsl(var(--recovery))",
          glow: "hsl(var(--recovery-glow))",
        },
        productivity: {
          DEFAULT: "hsl(var(--productivity))",
          glow: "hsl(var(--productivity-glow))",
        },
        // Status colors
        status: {
          green: "hsl(var(--status-green))",
          "green-foreground": "hsl(var(--status-green-foreground))",
          yellow: "hsl(var(--status-yellow))",
          "yellow-foreground": "hsl(var(--status-yellow-foreground))",
          red: "hsl(var(--status-red))",
          "red-foreground": "hsl(var(--status-red-foreground))",
        },
        // Priority colors
        priority: {
          high: "hsl(var(--priority-high))",
          medium: "hsl(var(--priority-medium))",
          low: "hsl(var(--priority-low))",
        },
        // Coach / grade colors
        grade: {
          excellent: "hsl(var(--grade-excellent))",
          good: "hsl(var(--grade-good))",
          average: "hsl(var(--grade-average))",
          poor: "hsl(var(--grade-poor))",
          failing: "hsl(var(--grade-failing))",
        },
        coach: {
          cotm: "hsl(var(--coach-cotm))",
          meddicc: "hsl(var(--coach-meddicc))",
          discovery: "hsl(var(--coach-discovery))",
        },
        nav: {
          today: "hsl(var(--nav-today))",
          tasks: "hsl(var(--nav-tasks))",
          outreach: "hsl(var(--nav-outreach))",
          renewals: "hsl(var(--nav-renewals))",
          prep: "hsl(var(--nav-prep))",
          coach: "hsl(var(--nav-coach))",
          trends: "hsl(var(--nav-trends))",
          quota: "hsl(var(--nav-quota))",
          settings: "hsl(var(--nav-settings))",
          dave: "hsl(var(--nav-dave))",
        },
          meddicc: "hsl(var(--coach-meddicc))",
          discovery: "hsl(var(--coach-discovery))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        "ring-grow": {
          from: { strokeDashoffset: "100" },
          to: { strokeDashoffset: "var(--target-offset)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "ring-grow": "ring-grow 1s ease-out forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
