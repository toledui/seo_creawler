import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/lib/auth';

export default async function Home() {
  const user = await getVerifiedUser();
  redirect(user ? '/dashboard' : '/login');
}
