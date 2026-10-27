import { Suspense } from 'react';
import GroupsPreview from './GroupsPreview';
export default function Page(){return <Suspense fallback={<p className="p-6">Loading preview…</p>}><GroupsPreview/></Suspense>}
