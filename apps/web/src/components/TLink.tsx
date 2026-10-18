import { forwardRef } from "react";
import { Link, useLocation, useNavigate, type LinkProps } from "react-router";
import { directionFor, setNavDirection } from "../lib/act";

/** A Link that animates with a View Transition, sliding in the right direction. */
export const TLink = forwardRef<HTMLAnchorElement, LinkProps>(function TLink({ onClick, to, ...props }, ref) {
  const location = useLocation();
  return (
    <Link
      ref={ref}
      to={to}
      viewTransition
      onClick={(e) => {
        const target = typeof to === "string" ? to : (to.pathname ?? location.pathname);
        setNavDirection(directionFor(location.pathname, target));
        onClick?.(e);
      }}
      {...props}
    />
  );
});

export function useTNavigate() {
  const navigate = useNavigate();
  const location = useLocation();
  return (to: string, dir?: "forward" | "back" | "fade") => {
    setNavDirection(dir ?? directionFor(location.pathname, to));
    void navigate(to, { viewTransition: true });
  };
}
