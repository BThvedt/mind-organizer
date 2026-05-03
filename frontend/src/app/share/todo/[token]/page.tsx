import { notFound } from 'next/navigation';
import { fetchSharedTodo } from '@/app/share/_lib/fetch-share';
import { SharedTodoListClient } from './todo-list-client';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const list = await fetchSharedTodo(token);
  return {
    title: list?.title ?? 'Shared todo list',
  };
}

export default async function SharedTodoPage({ params }: PageProps) {
  const { token } = await params;
  const list = await fetchSharedTodo(token);
  if (!list) notFound();

  return <SharedTodoListClient token={token} list={list} />;
}
