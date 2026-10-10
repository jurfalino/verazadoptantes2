'use client';
import { useLanguage } from '@/context/LanguageContext';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import type { InterviewView } from '@/app/actions/interviewTypes';
import type { Answer } from '@/domain/interview/types';
import { questionText } from './questionText';

function formatAnswer(a: Answer, t: (k: string) => string): string {
	if (a.status === 'skipped') return t('interview.skipped');
	if (a.status === 'no_answer') return t('interview.not_answered');
	if (a.text) return a.text;
	if (a.choice) return t(`interview.choice.${a.choice}`);
	if (typeof a.number === 'number') return String(a.number);
	if (a.contacts?.length) return a.contacts.map(c => `${t(`interview.contact_type_${c.type}`)}: ${c.value}`).join(' · ');
	if (a.household?.length) return a.household.map(h => `${h.name}${h.relationship ? ` (${t(`adopter.hh_rel_${h.relationship}`)})` : ''}`).join(', ');
	return t('interview.not_answered');
}

export default function InterviewReadOnly({ view }: { view: InterviewView }) {
	const { t, locale } = useLanguage();
	const date = view.completedAt ? new Date(view.completedAt * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: DEFAULT_TIMEZONE }) : '';
	const prepLines = [
		...view.prep.phones, ...view.prep.emails, ...view.prep.socials, ...(view.prep.address ? [view.prep.address] : []),
	];
	return (
		<article className="max-w-3xl mx-auto px-4 space-y-4" data-testid="interview-readonly">
			{view.adopterId && <a href={`/adopter/${view.adopterId}`} className="text-sm font-semibold text-teal-700 hover:underline">← {view.prep.name}</a>}
			<header>
				<h1 className="text-xl font-bold text-stone-900 break-words">{t('interview.readonly_title').replace('{name}', view.prep.name)}</h1>
				<p className="text-sm text-stone-600">{t('interview.readonly_by').replace('{who}', view.conductedByName).replace('{date}', date)}</p>
			</header>
			{prepLines.length > 0 && (
				<section className="bg-white rounded-2xl border border-stone-200 p-4">
					<h2 className="text-xs font-semibold text-teal-800 uppercase tracking-wider mb-1">{t('interview.prep_section')}</h2>
					<p className="text-sm text-stone-800 break-all">{prepLines.join(' · ')}</p>
				</section>
			)}
			<ol className="space-y-2">
				{view.visited.filter(id => view.answers[id]).map(id => (
					<li key={id} className="bg-white rounded-2xl border border-stone-200 p-4">
						<p className="text-sm font-semibold text-stone-900 break-words">{questionText(t, id, view.custom)}</p>
						<p className="text-sm text-stone-700 mt-1 whitespace-pre-wrap break-words">{formatAnswer(view.answers[id], t)}</p>
					</li>
				))}
			</ol>
		</article>
	);
}
