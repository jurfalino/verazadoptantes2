import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdopterImage } from '@/types/adopter';

// Mock the app boundaries so the component renders in isolation (no real server
// action, no context providers). t() echoes the key so we can assert on labels.
vi.mock('@/context/LanguageContext', () => ({
    useLanguage: () => ({ t: (k: string) => k }),
}));
vi.mock('@/components/ui/Toast', () => ({
    useShowToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/app/actions', () => ({ setProfilePicture: vi.fn() }));

import ProfilePhotoChooser from './ProfilePhotoChooser';

const img = (id: string, isProfile = false): AdopterImage => ({
    id,
    adopterId: 'a1',
    url: `https://example.com/${id}.jpg`,
    isProfilePicture: isProfile ? 1 : 0,
});

function render(images: AdopterImage[], isOpen = true) {
    return renderToStaticMarkup(
        <ProfilePhotoChooser
            isOpen={isOpen}
            onClose={() => {}}
            images={images}
            adopterId="a1"
            onUploadNew={() => {}}
        />,
    );
}

describe('ProfilePhotoChooser', () => {
    it('renders nothing when closed', () => {
        expect(render([img('1', true), img('2')], false)).toBe('');
    });

    it('renders one tile per selectable image plus an upload tile', () => {
        const html = render([img('1', true), img('2'), img('3')]);
        // three photo <img> tiles for the three images
        expect((html.match(/<img/g) || []).length).toBe(3);
        // the upload-new tile label is present
        expect(html).toContain('adopter.upload_new_photo');
    });

    it('marks the current profile photo with aria-current', () => {
        const html = render([img('1', true), img('2')]);
        expect((html.match(/aria-current="true"/g) || []).length).toBe(1);
    });

    it('excludes optimistic temp- ids from the grid', () => {
        const html = render([img('1', true), img('temp-abc'), img('2')]);
        // temp- image is filtered out → only 2 real tiles
        expect((html.match(/<img/g) || []).length).toBe(2);
    });

    it('still shows the upload tile when there are no images', () => {
        const html = render([]);
        expect((html.match(/<img/g) || []).length).toBe(0);
        expect(html).toContain('adopter.upload_new_photo');
    });
});
