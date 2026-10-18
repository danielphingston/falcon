import { EmptyState } from "../components/ui";
import { TLink } from "../components/TLink";

export function NotFound() {
  return (
    <div className="pt-10">
      <EmptyState
        title="Page not found"
        hint="That link doesn't go anywhere."
        action={
          <TLink to="/" className="btn btn-primary">
            Back to Today
          </TLink>
        }
      />
    </div>
  );
}
