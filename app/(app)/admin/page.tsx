import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth';
import { SectionTitle } from '@/components/ui';
import { AdminPanel } from '@/components/admin/AdminPanel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADMIN') redirect('/dashboard');

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Administración"
        description="Cuentas de la instancia, correo saliente y credenciales de Google."
      />
      <AdminPanel />
    </div>
  );
}
