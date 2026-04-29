// Force static pre-render at build time — avoids next-on-pages runtime-logic
// detection on /_not-found caused by root layout's await auth() inheritance.
export const dynamic = 'force-static';

export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h2 className="text-2xl font-semibold mb-4">Not Found</h2>
            <p>Could not find requested resource</p>
        </div>
    );
}
