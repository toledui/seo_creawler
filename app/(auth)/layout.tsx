export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-2 text-2xl font-semibold tracking-tight">
            SEO<span className="text-accent">Crawler</span>
          </div>
          <p className="text-sm text-muted">
            Rastreo técnico, interlinking y auditoría con IA
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
