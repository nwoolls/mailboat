import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "./Shell";

const queryClient = new QueryClient({
  defaultOptions: {
    // Data is local (SQLite via IPC); refreshes are driven by sync events.
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
