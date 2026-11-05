import { Button } from '@/components/ui/button';

/**
 * The last line of defence. The common cause: a tab left open across a deploy asks for a page's
 * code that no longer exists, and a reload picks up the new version.
 */
export function RouteError() {
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-gray-600">Reloading the page usually fixes this.</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </main>
  );
}
