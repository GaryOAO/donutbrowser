import "@/styles/globals.css";
import "flag-icons/css/flag-icons.min.css";
import { ClientProviders } from "@/components/client-providers";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased overflow-hidden bg-background">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
