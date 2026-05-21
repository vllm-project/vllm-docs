import { redirect } from 'next/navigation';

export default function RootIndex() {
  redirect('/getting_started/introduction');
}
