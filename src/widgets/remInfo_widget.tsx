import { usePlugin, renderWidget, useTracker, Rem } from '@remnote/plugin-sdk';
import { useEffect, useState } from 'react';
import { RemViewer } from '@remnote/plugin-sdk';

// Assuming Rem is a type defined elsewhere, e.g., imported from a library
interface ListComponentProps {
    title: string;
    rems: Rem[];
}
  
const ListComponent = ({ title, rems }: ListComponentProps) => {
    return (
        <div className="mb-4">
        <h3 className="text-lg font-bold">{title}</h3>
        <ul className="list-disc pl-5">
            {rems.map((rem: Rem) => (
            <li key={rem._id}>
                <RemViewer remId={rem._id} />
            </li>
            ))}
        </ul>
        </div>
    );
}

export function RemInfoWidget() {
    const plugin = usePlugin();

    const focusedRem = useTracker(async (reactPlugin) => {
            return await reactPlugin.focus.getFocusedRem();
        }
    );

    // State variables for Rem data
    const [tags, setTags] = useState<Rem[]>([]);
    const [taggedRems, setTaggedRems] = useState<Rem[]>([]);
    const [ancestorTags, setAncestorTags] = useState<Rem[]>([]);
    const [descendantTags, setDescendantTags] = useState<Rem[]>([]);
    const [referencingRems, setReferencingRems] = useState<Rem[]>([]);
    const [referencedRems, setReferencedRems] = useState<Rem[]>([]);
    const [deepReferencedRems, setDeepReferencedRems] = useState<Rem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (focusedRem) {
            // Reset all states to empty arrays when a new Rem is selected
            setTags([]);
            setTaggedRems([]);
            setAncestorTags([]);
            setDescendantTags([]);
            setReferencingRems([]);
            setReferencedRems([]);
            setDeepReferencedRems([]);
            setLoading(true);

            const fetchData = async () => {
            try {
                const [
                tagsData,
                taggedRemsData,
                ancestorTagsData,
                descendantTagsData,
                referencingRemsData,
                referencedRemsData,
                deepReferencedRemsData,
                ] = await Promise.all([
                focusedRem.getTagRems(),
                focusedRem.taggedRem(),
                focusedRem.ancestorTagRem(),
                focusedRem.descendantTagRem(),
                focusedRem.remsReferencingThis(),
                focusedRem.remsBeingReferenced(),
                focusedRem.deepRemsBeingReferenced(),
                ]);

                // Update states with new data
                setTags(tagsData || []);
                setTaggedRems(taggedRemsData || []);
                setAncestorTags(ancestorTagsData || []);
                setDescendantTags(descendantTagsData || []);
                setReferencingRems(referencingRemsData || []);
                setReferencedRems(referencedRemsData || []);
                setDeepReferencedRems(deepReferencedRemsData || []);
            } catch (error) {
                console.error('Error fetching Rem data:', error);
            } finally {
                setLoading(false);
            }
            };

            fetchData();
        } else {
            // No Rem focused: reset states and stop loading
            setTags([]);
            setTaggedRems([]);
            setAncestorTags([]);
            setDescendantTags([]);
            setReferencingRems([]);
            setReferencedRems([]);
            setDeepReferencedRems([]);
            setLoading(false);
        }
    }, [focusedRem]);

    return (
        <div className="overflow-y-auto max-h-[500px]">
        {loading ? (
        <div>Loading...</div>
        ) : !focusedRem ? (
        <div>No Rem is currently focused.</div>
        ) : (
        <div>
            <ListComponent title="Tags" rems={tags} />
            <ListComponent title="Tagged Rems" rems={taggedRems} />
            <ListComponent title="Ancestor Tags" rems={ancestorTags} />
            <ListComponent title="Descendant Tags" rems={descendantTags} />
            <ListComponent title="Rems Referencing This" rems={referencingRems} />
            <ListComponent title="Rems Being Referenced" rems={referencedRems} />
            <ListComponent title="Deep Rems Being Referenced" rems={deepReferencedRems} />
        </div>
        )}
        </div>
    ); 
}

renderWidget(RemInfoWidget);