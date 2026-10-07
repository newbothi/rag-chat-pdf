import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chat con tus PDFs',
  description: 'RAG con Next.js, SQL Server 2025 y Vercel AI SDK',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">{children}</body>
    </html>
  );
}
