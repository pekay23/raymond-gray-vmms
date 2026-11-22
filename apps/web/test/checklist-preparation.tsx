import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WorkOrderChecklists } from "../src/work-order-checklists";
import type { WorkOrder } from "../src/api";
import { ToastProvider } from "../src/ui";
import "../src/styles.css";

const siteId = "10000000-0000-4000-8000-000000000001";
const workOrderId = "20000000-0000-4000-8000-000000000001";
const order = { id: workOrderId, version: 4 } as unknown as WorkOrder;
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <main className="mx-auto max-w-3xl p-4 sm:p-8">
            <WorkOrderChecklists order={order} siteId={siteId} canWrite />
          </main>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);
