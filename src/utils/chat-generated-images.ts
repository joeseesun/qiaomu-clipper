import { readLibraryBlob, removeLibraryImages, saveLibraryImage } from './image-library-store';
// Kept for chat references. The gallery now owns their lifetime.
export const getChatImage = readLibraryBlob;
export const deleteChatImages = removeLibraryImages;
export async function saveChatImage(blob: Blob): Promise<string> {
 const id = crypto.randomUUID();
 await saveLibraryImage(blob, { id, name: 'Image', created: Date.now(), source: 'generated' });
 return id;
}
