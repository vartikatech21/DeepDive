import { Suspense } from "react";
import RepoWorkspace from "@/components/RepoWorkspace";

type Params = Promise<{ owner: string; name: string }>;

// The repo name is only known at request time, so it streams in inside <Suspense>.
export default function RepoPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-dvh" />}>
      <Workspace params={params} />
    </Suspense>
  );
}

async function Workspace({ params }: { params: Params }) {
  const { owner, name } = await params;
  return <RepoWorkspace key={`${owner}/${name}`} owner={decodeURIComponent(owner)} name={decodeURIComponent(name)} />;
}
