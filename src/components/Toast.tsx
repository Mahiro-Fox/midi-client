import { IconClose } from "./icons";

type Props = { message: string; onClose: () => void };

export default function Toast({ message, onClose }: Props) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-6">
      <div className="animate-rise pointer-events-auto flex max-w-[620px] items-start gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
        <span className="text-[12.5px] leading-relaxed text-zinc-200">{message}</span>
        <button
          onClick={onClose}
          className="mt-1 shrink-0 text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <IconClose className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
