import {
  BookOpen,
  Briefcase,
  Building2,
  Compass,
  DollarSign,
  GraduationCap,
  Handshake,
  ListTodo,
  Mic,
  Rocket,
  Search,
  Sprout,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

export const GROUP_ICONS: Record<string, LucideIcon> = {
  target: Target,
  briefcase: Briefcase,
  users: Users,
  handshake: Handshake,
  mic: Mic,
  building: Building2,
  search: Search,
  "dollar-sign": DollarSign,
  sprout: Sprout,
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  compass: Compass,
  rocket: Rocket,
  "list-todo": ListTodo,
};

export function GroupIcon({ name, className }: { name: string; className?: string }) {
  const Icon = GROUP_ICONS[name] ?? ListTodo;
  return <Icon className={className} aria-hidden />;
}

export function GroupDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${className ?? ""}`} style={{ backgroundColor: color }} />;
}
