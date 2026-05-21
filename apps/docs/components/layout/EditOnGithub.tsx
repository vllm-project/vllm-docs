import { Github } from 'lucide-react';

interface EditOnGithubProps {
  editUrl: string;
}

export function EditOnGithub({ editUrl }: EditOnGithubProps) {
  return (
    <div className="mt-10 pt-5 border-t flex">
      <a
        href={editUrl}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Github className="size-3.5" />
        Edit this page on GitHub
      </a>
    </div>
  );
}
