import { usePlugin, renderWidget, useTracker, Rem, RNPlugin, RemType } from '@remnote/plugin-sdk';
import { useEffect, useState } from 'react';
import { RemViewer } from '@remnote/plugin-sdk';
import { specialTags, getRemText, isReferencingRem, getParentClassType, getAncestorLineageStrings, getClassProperties, getClassDescriptors } from '../utils/utils';

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
    const [properties, setProperties] = useState<Rem[]>([]);
    const [descriptors, setDescriptors] = useState<Rem[]>([]);
    const [tags, setTags] = useState<Rem[]>([]);
    const [taggedRems, setTaggedRems] = useState<Rem[]>([]);
    const [ancestorTags, setAncestorTags] = useState<Rem[]>([]);
    const [descendantTags, setDescendantTags] = useState<Rem[]>([]);
    const [referencingRems, setReferencingRems] = useState<Rem[]>([]);
    const [referencedRems, setReferencedRems] = useState<Rem[]>([]);
    const [deepReferencedRems, setDeepReferencedRems] = useState<Rem[]>([]);
    const [classType, setClassType] = useState<Rem[]>([]);
    const [lineage, setLineage] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (focusedRem) {
            // Reset all states to empty arrays when a new Rem is selected
            setProperties([]);
            setDescriptors([]);
            setTags([]);
            setTaggedRems([]);
            setAncestorTags([]);
            setDescendantTags([]);
            setReferencingRems([]);
            setReferencedRems([]);
            setDeepReferencedRems([]);
            setClassType([]);
            setLineage([]);
            setLoading(true);

            const fetchData = async () => {
            try {
                const [
                propertiesData,
                descriptorsData,
                tagsData,
                taggedRemsData,
                ancestorTagsData,
                descendantTagsData,
                referencingRemsData,
                referencedRemsData,
                deepReferencedRemsData,
                classTypeData,
                lineageData
                ] = await Promise.all([
                getClassProperties(plugin, focusedRem),
                getClassDescriptors(plugin, focusedRem),
                focusedRem.getTagRems(),
                focusedRem.taggedRem(),
                focusedRem.ancestorTagRem(),
                focusedRem.descendantTagRem(),
                focusedRem.remsReferencingThis(),
                focusedRem.remsBeingReferenced(),
                focusedRem.deepRemsBeingReferenced(),
                // TODO: Multiple Lineages
                getParentClassType(plugin, focusedRem),
                getAncestorLineageStrings(plugin, focusedRem)
                ]);

                // Update states with new data
                setProperties(propertiesData || []);
                setDescriptors(descriptorsData || []);
                setTags(tagsData || []);
                setTaggedRems(taggedRemsData || []);
                setAncestorTags(ancestorTagsData || []);
                setDescendantTags(descendantTagsData || []);
                setReferencingRems(referencingRemsData || []);
                setReferencedRems(referencedRemsData || []);
                setDeepReferencedRems(deepReferencedRemsData || []);
                classTypeData != null ? setClassType(classTypeData) : setClassType([]);
                setLineage(lineageData || 'None');
            } catch (error) {
                console.error('Error fetching Rem data:', error);
            } finally {
                setLoading(false);
            }
            };

            fetchData();
        } else {
            // No Rem focused: reset states and stop loading
            setProperties([]);
            setTags([]);
            setTaggedRems([]);
            setAncestorTags([]);
            setDescendantTags([]);
            setReferencingRems([]);
            setReferencedRems([]);
            setDeepReferencedRems([]);
            setClassType([]);
            setLineage([]);
            setLoading(false);
        }
    }, [focusedRem, plugin]);

    // <p>Parent Class Type: {classType ? <RemViewer remId={classType[0]._id} /> : 'None'}</p>
    return (
        <div className="overflow-y-auto max-h-[500px]">
        {loading ? (
        <div>Loading...</div>
        ) : !focusedRem ? (
        <div>No Rem is currently focused.</div>
        ) : (
        <div>
            <ListComponent title="Parent Types" rems={classType} />
            <div>
            <p>Ancestor Lineage:</p>
                {lineage.map((lin, index) => (
                <p key={index}>{lin}</p>
                ))}
            </div>
            <ListComponent title="Properties" rems={properties} />
            <ListComponent title="Descriptors" rems={descriptors} />
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