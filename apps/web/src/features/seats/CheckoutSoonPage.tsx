import { Link, useParams } from 'react-router';

/** Day 17 replaces this with the real checkout, on the same route. */
export function CheckoutSoonPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">Checkout isn't open yet</h1>
      <p className="text-gray-600">Your seats stay held until the timer runs out.</p>
      <Link to={`/e/${slug}/seats`} className="text-blue-600 hover:underline">
        ← Back to your seats
      </Link>
    </div>
  );
}
