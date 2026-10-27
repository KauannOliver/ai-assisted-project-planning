import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'TIC — Gestão de Projetos',
  description: 'Mecanismo de governança, priorização, capacidade e previsão.',
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
