import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AuthCard(props: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-gray-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">{props.title}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>{props.children}</CardContent>
      </Card>
    </main>
  );
}
