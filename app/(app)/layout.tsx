import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { accessibleOwnerIds } from '@/lib/access';
import { Sidebar } from '@/components/shell/Sidebar';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect('/login');

  // Incluye los proyectos de los espacios de trabajo a los que le han
  // invitado, no sólo los suyos.
  const projects = await prisma.project.findMany({
    where: { userId: { in: await accessibleOwnerIds(user.id) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, domain: true },
    take: 50,
  });

  return (
    // La ventana no scrollea: el sidebar queda fijo a la altura de la
    // pantalla y sólo se desplaza el contenido de la derecha.
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} projects={projects} />
      {/* pt-16 en móvil deja hueco al botón ☰, que va en position:fixed y
          si no se comería el título de la página. */}
      <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-6 pt-16 md:px-8 md:py-6">
        {children}
      </main>
    </div>
  );
}
