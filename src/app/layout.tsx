import type { Metadata, Viewport } from "next";
import { Newsreader, Nunito_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: "Room reservations and facility scheduling for Victory Church.",
  applicationName: APP_NAME,
  icons: { icon: "/brand/victory-mark.png", apple: "/brand/victory-mark.png" },
  // The portal stays out of search results; the public pages opt back in.
  robots: { index: false, follow: false },
  // Optional Search Console meta tag, used to verify the domain for Google OAuth branding.
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
};

export const viewport: Viewport = {
  themeColor: "#faf8f4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunitoSans.variable} ${newsreader.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            classNames: {
              toast: "!rounded-md !border !border-line !bg-ink !text-white !shadow-lg !font-sans",
              description: "!text-white/75",
              success: "[&_[data-icon]]:!text-[#7fd1a3]",
              error: "[&_[data-icon]]:!text-[#ff9aa2]",
              warning: "[&_[data-icon]]:!text-accent",
            },
          }}
        />
      </body>
    </html>
  );
}
