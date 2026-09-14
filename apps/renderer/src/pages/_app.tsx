import type { AppProps } from "next/app";
import Head from "next/head";
import { IBM_Plex_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import messages from "@path/shared/messages/en.json";
import { RendererProvider } from "@/components/RendererProvider";
import { routeHasRecordingControls } from "@/lib/Routes";
import "../styles/index.css";

const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"] });

const THEME_STORAGE_KEY = "path.theme";

export default function App({ Component, pageProps, router }: AppProps) {
  return (
    <>
      <Head>
        <title>{messages.app.name}</title>
        <meta name="description" content={messages.app.description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style jsx global>{`
        :root {
          --font-mono: ${mono.style.fontFamily};
        }
      `}</style>
      <ThemeProvider
        attribute="data-theme"
        storageKey={THEME_STORAGE_KEY}
        defaultTheme="light"
        enableSystem={false}
        disableTransitionOnChange
      >
        {/* Keep static translations deterministic; recording dates use the local format helper. */}
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <RendererProvider hasRecordingControls={routeHasRecordingControls(router.pathname)}>
            <Component {...pageProps} />
          </RendererProvider>
        </NextIntlClientProvider>
      </ThemeProvider>
    </>
  );
}
