import { cn } from "@/lib/ui-utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("skeleton", className)} {...props} />;
}
