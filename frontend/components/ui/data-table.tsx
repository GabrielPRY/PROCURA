import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";

export function DataTable<TData>({
  data,
  columns,
  emptyTitle = "Sin datos",
  emptyCopy,
  className
}: {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  emptyTitle?: string;
  emptyCopy?: string;
  className?: string;
}) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  if (!data.length) return <EmptyState title={emptyTitle} copy={emptyCopy} />;

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-line", className)}>
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="border-b border-line px-4 py-3 font-semibold">
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-line bg-white">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-blue-50/40">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 align-top text-slate-700">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
