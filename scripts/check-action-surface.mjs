#!/usr/bin/env node
/**
 * A ratchet on the browser-callable surface.
 *
 * Every export of a `'use server'` module becomes a POST endpoint, and Next
 * records one id per export in the compiled server-reference manifest. That
 * manifest maps ids to the routes that serve them and carries no source path,
 * so the only thing it can tell us is HOW MANY doors exist. That turns out to
 * be the useful question: the number should change only when someone means it.
 *
 * `src/app/actions/notifications.ts` going back on the wire moves it from 148
 * to 161 in one step, because all thirteen of its exports become endpoints —
 * the write side takes the recipient, title, body and link as arguments and
 * checks none of them, and the read side pages through any named user's bell,
 * which carries adopter name, phone, address and DNI in `metadata`. Measured,
 * not assumed: both numbers came from building it each way.
 *
 * Unlike `src/lib/serverActionSurface.test.ts`, this does not care how the
 * directive is written or where it sits, and it also notices a NEW action that
 * wraps a trusted helper under a different name — the one shape no source scan
 * can distinguish from an ordinary action that happens to notify someone.
 *
 * Adding a server action on purpose means raising EXPECTED_ACTIONS in the same
 * commit. That is the point, not an inconvenience: it makes every new door a
 * decision someone signed off on.
 *
 * Run after `npm run build`.
 */
import { readFileSync } from 'node:fs';

const MANIFEST = '.next/server/server-reference-manifest.json';
// 150 since v2.56.82: `getPendingAsks` and `resolvePendingAsk`
// (src/app/actions/pendingSearches.ts), the read and write behind the
// "Quedó pendiente" deck. Checked against the rule above — what a stranger
// can do with arguments they choose:
//   getPendingAsks()      takes nothing, and every row it reads is filtered by
//                         the caller's own session email; logged out it returns [].
//   resolvePendingAsk()   takes ids, but each UPDATE carries
//                         `user_email = <session>`, so a guessed id closes
//                         nothing; `resolution` is checked against the two
//                         allowed values, and the array is length-capped.
// The writes themselves (recording a search, closing asks after a record) stay
// in src/lib/pendingSearchLog.ts precisely so they never become endpoints.
// 153 since v2.56.86: `addAnimalPhoto`, `deleteAnimalPhoto` and
// `setAnimalPrimaryPhoto` (src/app/actions/animalTimeline.ts) — the only way to
// change an animal's photos after it is created. Checked against the rule above
// — what a stranger can do with arguments they choose:
//   all three        take an `animalId`, shaped by zod, then gated by
//                    assertCanEditAnimal (owner ∨ org-mate ∨ admin, and the
//                    animal must not be soft-deleted). A stranger, or a member
//                    of another org, gets `Not found` either way.
//   the two that     also take an `imageId`, and loadOwnPhoto requires
//   take an image    `adoption_id === animalId`. A guessed id belonging to
//                    another animal — or to an adopter's AVATAR, which lives in
//                    the same table — matches nothing. setAnimalPrimaryPhoto's
//                    demotion UPDATE is scoped `WHERE adoption_id = animalId`
//                    for the same reason.
//   addAnimalPhoto   takes a data URL: required to be `data:image/` and capped
//                    at 8 MB, so it cannot be used to push bulk into D1. It is
//                    strictly NARROWER than the `saveImage` door already on the
//                    wire, which takes any adopterId with no ownership check.
// 158 since v2.56.101: the five actions in src/app/actions/adoptionDocs.ts
// behind the custom adoption form + contract (/settings card and editor).
// Checked against the rule above — what a stranger can do with arguments they
// choose. All five call getUser() first (throws with no session) and return
// `disabled` while ENABLE_CUSTOM_ADOPTION_DOCS is off, so today none does
// anything at all:
//   getAdoptionDocsOverview()  takes nothing; reads only the caller's own
//                              settings and the groups the caller's session
//                              email is a member of.
//   setAdoptionDocsSource()    takes 'self' | 'org:<id>'; anything else is
//                              `invalid`, and an org the caller is not a member
//                              of is `forbidden`. Writes only the caller's own
//                              user_profiles row, only that one column.
//   getAdoptionDocs(owner)     `self` is always the session email — no email
//   saveFormSteps(owner, …)    argument exists anywhere; `org` requires an
//   saveContractSections(…)    org_members row for the session email, else
//                              `forbidden`. Step ids are filtered to the known,
//                              non-locked set; contract text must pass a strict
//                              zod schema (three section keys, paragraph and
//                              bullet-list blocks, bold/italic/underline marks,
//                              ≤ 8,000 chars and ≤ 200 blocks per section) and
//                              is stored as JSON, never HTML. A stranger can
//                              read or edit only their own docs; a member can
//                              edit their group's, which is the product rule.
// 160 since v2.56.119: startViewAs(userId) and stopViewAs() in
// src/app/actions/viewAs.ts — an admin browsing as another user, read-only.
// Both only forward a session update; what a stranger can do with them is
// exactly what they can already do by POSTing that update to
// /api/auth/session, and the jwt callback (src/lib/viewAsSession.ts) decides:
//   startViewAs(userId)  refused unless the session's own email is an admin
//                        (bootstrap list or DB role, re-checked every request)
//                        and the target exists, is not an admin and is not
//                        them. Writes one audit_log row; nothing else.
//   stopViewAs()         takes nothing; only ever drops the caller's own claim.
// While a claim is active every D1 write fails (src/lib/readOnlyGuard.ts).
// 161 since v2.56.128: setAnimalListed(animalId, listed) in
// src/app/actions/animalTimeline.ts — the rescuer's switch for the public
// catalogue (an animal under treatment or already promised sits out without
// being adopted away). Safe with arguments a stranger chooses: the id is
// zod-shaped, assertCanEditAnimal gates on owner ∨ org-mate ∨ admin and is
// the same gate the other five animal actions use, and the only writable
// value is a boolean collapsed to 0/1. The worst a permitted caller can do is
// hide or show their own team's animal, which is the feature. Audited.
// 162 since v2.56.129: linkFormToExistingAdopter(submissionId, adopterId) in
// src/app/actions/formSubmission.ts — "Es la misma persona" on form-results.
// It merges profiles, so the guard is the point. Safe with arguments a
// stranger chooses: only the submission's owner (form_submissions.user_id ==
// session email) passes; the target must be a match recorded in THEIR
// notification at submit time, live, and not the form's own auto-created
// profile; the only profile ever absorbed is that auto-created one, and a
// form already on an existing profile is refused rather than moved
// (planFormLink in src/domain/formLink.ts, unit-tested). Retries are no-ops.
// The merge is the shared, undoable mergeAdopters. Audited.
// 161 since the reel-11 fixes: getOrgMemberEmailsFor(email) LEFT the surface.
// It took any email, checked no session, and answered "who are this person's
// org-mates?" — an endpoint only because it was an export of the 'use server'
// src/app/actions/organizations.ts (which client pages import, so every export
// got an id). Moved, unchanged, to src/lib/orgMembership.ts; its callers are
// all server code (notifications fan-out, findAdopters, piiAccessServer).
// 146 since the reel-11 fixes (measured): 16 doors closed, 1 opened.
//   CLOSED — server helpers that checked no session, so they never belonged on
//   the wire. Moved to plain modules, or their file lost 'use server':
//     mergeAdopters, mergeCandidatePair, unmergeAdopters → src/lib/adopterMerge.ts
//       (mergeAdopters' id shipped in /my-adopters' JS: anyone could merge any
//       two profiles and read the victim's contact on their own)
//     tokenizeAdopter → src/lib/adopterTokenize.ts
//     createAdopterFromSubmission (_adopterFactory.ts), resolveUserNames
//       (userNames.ts), getUserCountry (userCountry.ts), enrichAdopters,
//       hydrateDuplicateMatches — same files, directive removed
//     getDb, getUser, getIsAdmin, getIsModeratorOrAdmin, checkIsAdmin,
//       checkIsAdminAsync, checkIsModeratorOrAdminAsync — _db.ts, directive
//       removed (checkIsAdmin(email) answered "is this email an admin?")
//   OPENED — mergePendingDedupPair(candidateId) in src/app/actions/duplicates.ts,
//   the only browser door to a merge. Safe with arguments a stranger chooses:
//   the actor is the session (anonymous → refused); the id must be a pending
//   duplicate_candidates row or a manual duplicate flag the caller's feed lists
//   (they created a live side); and ownership, never age, decides what may be
//   absorbed: the absorbed (newer) record must be the caller's or a teammate's,
//   and a flag needs both sides in the team — so a foreign profile is never
//   folded into the caller's, whatever createdAt says (decideDedupMerge,
//   src/domain/dedupPair.ts, unit + integration tested). Refusals are logged
//   with an errorId; the merge is the shared, undoable, audited one.
// Still 146 after the audit fixes: findAdopters MOVED, it did not multiply.
// The engine (src/app/actions/findAdopters.ts) lost 'use server' — its
// 'duplicate' mode runs without a session for the public form/contract submit
// and must not be browser-selectable — and the browser's findAdopters is now
// the thin action in src/app/actions/findAdoptersAction.ts: discovery passes
// through (the engine masks for anonymous viewers), 'duplicate' needs a
// session. Same audit, no count change: saveAdopter (session required,
// columns whitelisted), saveAdoption (edits owner/team/admin), getAdoptions /
// getAdoptionImages (signed-in), fetchMetrics / fetchTopErrors7d (admin),
// markContractKeepNew (own/team profile), setProfilePicture (image must be
// the adopter's).
// Interview guide (ENABLE_INTERVIEW_GUIDE): nine exports in
// src/app/actions/interviews.ts (8) + interviewComplete.ts (1). MEASURED still
// 146: Next only records an id for a 'use server' export that some route or
// client module references, and nothing imports these yet (the UI lands in a
// later task). EXPECTED_ACTIONS therefore stays 146 until the first import
// ships; then it becomes 155 (146 + 9) in THAT commit. Signed off here against
// the rule above — what a stranger can do with arguments they choose. Every
// door needs a session and the flag, and every error is logged through safeError
// (bound params stripped):
//   previewInterviewCandidates(prep)  — the same masked duplicate search the
//                                       add-adopter form already exposes.
//   startInterview({prep|adopterId})  — creates a draft owned by the caller;
//                                       candidates come from the server-side match,
//                                       a forged lead id is dropped. With adopterId
//                                       it reuses the open profile draft (partial
//                                       unique index + insert-or-reselect).
//   saveInterviewDraft(id, patch)     — interviewer only, drafts only (a completed
//                                       interview is never revived); zod caps sizes.
//   refreshInterviewCandidates(id)    — interviewer only; re-matches from the STORED
//                                       draft, no caller-supplied identifiers.
//   getInterview(id)                  — drafts: interviewer only; completed: D7
//                                       (interviewer, owner, owner's org-mates, admins).
//   listMyInterviewDrafts()           — the caller's own drafts only.
//   verifyInterviewFact(id, questionId, candidateId) — interviewer only. The fact
//                                       comes from the bank question's `verifies`;
//                                       values only from THAT question's saved answer
//                                       (<=3 contacts, <=1 street pair for address);
//                                       the candidate must be in the interview's
//                                       server-recorded list; 5-call budget per
//                                       (candidate, fact) per interview; returns only
//                                       a boolean — no value leaves the server.
//   discardInterviewDraft(id)         — interviewer only, drafts only.
//   completeInterview(id, input)      — interviewer only; target must be 'new' or a
//                                       recorded candidate (and match a persisted
//                                       adopter_id on retry); deterministic observation
//                                       id `${interviewId}-obs`, idempotent retries,
//                                       household dedupe; only collected values are
//                                       written, through saveAdopter / appendToExisting-
//                                       Adopter / addHouseholdMember / saveAdoption with
//                                       their own gates. Audited.
// Task 10 wired the interview actions (MEASURED 154 = 146 + 8): InterviewApp/InterviewPrep/
// useInterviewAutosave and the /interview pages import previewInterviewCandidates,
// startInterview, saveInterviewDraft, refreshInterviewCandidates, getInterview,
// listMyInterviewDrafts, discardInterviewDraft; the 8th is the rest of interviews.ts that
// Next records with them (verifyInterviewFact). interviewComplete.ts is not imported yet, so
// it becomes 155 when Task 13 imports it.
// Task 13: completeInterview became wired in this commit (InterviewReview imports it);
// MEASURED 155 = 146 + 9.
// v2.56.151: setRatingsAuditReviewed(recordId, reviewed) — "Está bien así" on the
// Calificaciones vs. notas report. Moderators + admins; fingerprint taken server-side
// from the persisted rating + note (never client-supplied); writes only
// ratings_audit_reviews; audited. 156 = 155 + 1.
// v2.56.171: getLinkedFormSubmissions(adopterId) REMOVED — an unauthenticated action
// that returned every linked form's answers (PII) for any profile id; nothing on
// screen used it, but Next still published it with the adopters module. 155 = 156 − 1.
// Email prefs (merge requests + email notifications, Task 3): getEmailPrefs() and
// saveEmailPref(category, enabled) in settings.ts — both session-gated, own row only. 157 = 155 + 2.
// Merge requests (Task 7): resolveMergeRequest(requestId, 'accept' | 'decline') and
// cancelMergeRequest(requestId) in src/app/actions/mergeRequests.ts. Safe with a request id
// a stranger chooses: the actor is the session (anonymous → refused); answerMergeRequest
// (src/lib/mergeRequests.ts) lets only the requester cancel, only the other owner's team
// (never the requester) or an admin accept/decline (decideMergeRequestAnswer, unit +
// integration tested); status moves by compare-and-set so the merge runs once; the merge
// is the shared, audited, undoable mergeAdopters. Refusals logged with an errorId.
// COMPUTED, not measured: nothing imports them until the PendingDedup / admin-list UI
// tasks, and Next only records referenced actions. 159 = 157 + 2.
// MEASURED 159 once wired (Task 11 build): EmailNotificationsSection imports getEmailPrefs /
// saveEmailPref; PendingDedup and MergeRequestsPanel import resolveMergeRequest / cancelMergeRequest.
// Pendientes D, Task 2: +1 = saveMyLocale (settings.ts), imported by LanguageContext's
// setLocale, so it is wired. 160 = 159 + 1. Session-checked; the only argument is
// validated against es|en|pt and writes the caller's own profile row.
// Pendientes D, Task 4: +1 = sendPairMessage (pairMessages.ts, «Escribirle»). COMPUTED, not
// measured: nothing imports it until the PendingDedup UI task wires it, and Next only records
// referenced actions. Session-checked; team/requester-only; never returns recipient emails.
// 161 = 160 + 1.
// Pendientes D, Task 5: +1 = hidePendingPair(pairKey) (duplicates.ts, «Quitar de la lista», D27).
// COMPUTED, not measured: nothing imports it until the PendingDedup UI task (Task 7) wires it,
// and Next only records referenced actions. Session-checked; the key is shape-checked (two
// distinct ids, ≤ 200 chars) and the only write is the caller's own pending_pair_hidden row —
// a stranger's key can only hide rows from their own list. Refusals logged with an errorId.
// 162 = 161 + 1.
// 163 since the linked convivientes (spec 2026-10-25 pendientes D): +1 =
// reportNotLivingTogether(linkId) (src/app/actions/householdLinks.ts, «No convive», D48 —
// one shared reality, 2.57.1: it REPLACED D47's hideHouseholdLink one-for-one, so the count
// did not move). MEASURED (npm run build: 163). What a stranger can do with arguments they
// choose: it takes only a link id (capped at 200 chars); getUser() first (no session →
// not_authenticated); then it acts only when the session is the LINKED profile's owner (the
// live profile, followed through a merge), a teammate of theirs, or an admin — anyone else,
// including the host's own team, gets `not_found`, the same answer as a guessed id, so it
// cannot probe which links exist. Its writes: that ONE member (the link's member id, still
// pointing at the linked profile) off the host's household via compare-and-swap — no other
// member or field of the host changes, even when another rescuer owns the host; then one
// batch: the household_links row deleted, one household_link_corrections row (with the
// removed member's JSON, for an admin to restore), one adopter_history row on each of the
// two profiles; then notices to the host's owner team (never the actor). Returns only
// { success, error?, errorId? } — no profile data, no emails. The summaries it sits beside
// are read by src/lib/householdLinks.ts getLinkedSummaries, a plain server module called by
// the profile page — deliberately NOT an endpoint; so are the merge/undo link moves.
// 163 = 162 + 1.
// One shared reality (2.57.1), Task 1 — disputes (D49, D50): +3 in
// src/app/actions/mergeDisputes.ts. COMPUTED, not measured: nothing imports them until the
// UI task (Task 3) wires them, and Next only records referenced actions, so EXPECTED_ACTIONS
// stays 163 here and becomes 166 (measured in Task 4) in the commit that imports them.
// What a stranger can do with arguments they choose:
//   raiseMergeDispute(auditId)        session required; the id is capped at 200 chars; the
//                                     only write is one merge_disputes row (one open per merge,
//                                     partial unique index), and only when the session is on the
//                                     owner team of the survivor or the absorbed profile of THAT
//                                     merge and is not the rescuer who merged (nor on a solo
//                                     merge) — anyone else, and any id that is not an
//                                     adopter_merge audit row, gets `not_found`. Notifies admins.
//   getMergeDisputeOption(auditId)    session required; returns only { canRaise, status } and
//                                     'none' for anyone who may not raise it — no names, ids,
//                                     emails or merge details, so it cannot probe merges.
//   resolveMergeDispute(id, decision) admin only (decideMergeDisputeResolution); decision is
//                                     checked against undo|keep; status moves by compare-and-set
//                                     so the undo (the shared, audited unmergeAdopters) runs once.
// The workers that take the actor (fileMergeDispute, answerMergeDispute, mergeDisputeOption,
// src/lib/mergeDisputes.ts) are listed in MUST_NOT_BE_ACTIONS (serverActionSurface.test.ts).
// One shared reality (2.57.1), Task 3 — the UI wires those three: raiseMergeDispute and
// getMergeDisputeOption (MergeDisputePrompt on the profile, `?dispute=<auditId>`) and
// resolveMergeDispute (MergeDisputesSection, admin «Disputas»). MEASURED (npm run build: 166).
// No other new action: the admin lists are read by the page (lib), «No convive» was already
// counted, and the D52 confirmation row calls nothing new. 166 = 163 + 3.
// Households as profiles, Task 2: +4 in src/app/actions/households.ts, exported from the
// barrel. MEASURED (npm run build: 170) — the barrel export alone makes Next record them.
// What a stranger can do with arguments they choose (every door needs a session; the
// actor is the session, never an argument; errors are codes, failures carry an errorId):
//   addHouseholdPerson(input)          anchor must be a live profile; a chosen householdId
//                                      must exist AND hold the anchor (else not_found), so a
//                                      guessed id puts nobody anywhere; existingProfileId must
//                                      be live and not the anchor. A new profile is owned by the
//                                      ANCHOR's owner (never the caller), protected (is_public 0),
//                                      needs a name or a contact; contacts are zod-checked as
//                                      addContactEntry's (≤20) and credited to the caller, who
//                                      gets entry grants only on what they typed. Caps: 30 people
//                                      per household, 10 households per profile. Writes history as
//                                      'contribution' for anyone without standing (never an editor).
//   updateHouseholdMembership(input)   open to anyone signed in by design (spec «Editing»):
//                                      only the relationship, checked against RELATIONSHIPS,
//                                      compare-and-swap; credited + history + the household's
//                                      teams told, so every change is visible to the owners.
//   removeHouseholdMembership(input)   canRemoveMembership on the STORED rows (the adder — never
//                                      on a profile's own anchor row, which has no adder; the
//                                      team of a household profile whose membership that team
//                                      did NOT add, so standing is never self-granted;
//                                      admins/moderators), else not_authorized; reason checked
//                                      against mistake|not_living; never deletes a profile.
//   getHouseholdMatchCandidates(input) the same masked duplicate check «Nuevo adoptante»
//                                      already exposes (src/lib/formDuplicates.ts, also searching
//                                      by a contact alone — an option findFormDuplicates never
//                                      accepts from the browser) plus each match's household line
//                                      (names, rating, alert counts — no contacts).
// The notice workers that take the actor (src/lib/householdNotices.ts) are plain lib code.
// 170 = 166 + 4.
// Households as profiles, Task 3: +4 in src/app/actions/profileIdentity.ts, exported from
// the barrel. What a stranger can do with arguments they choose (session required; the
// actor is the session; errors are codes, failures carry an errorId):
//   changeProfileName(input)     open by design (Jon, 2026-10-27): renames ANY live profile,
//                                but only while the stored name equals `expectedName`
//                                (compare-and-set, else `conflict`); ≤200 chars, never empty.
//                                The old name stays a name token (hidden rename alias), history
//                                is 'contribution' for a stranger (never an approver), and the
//                                owner's team is told in-app + by email with «Deshacer».
//   changeProfileAge(input)      open by design: integer 0–120 or null + the «menor» box;
//                                credited, history, owner's team told. «Menor» is a marker only
//                                (Jon, 2026-10-28): any profile can be marked.
//   undoProfileRename(historyId) owner ∨ org-mate ∨ admin ∨ moderator of the profile, else
//                                not_authorized; only a rename row (never an undo), only while
//                                the profile still carries that rename's name, once.
//   getRenameUndoOption(id)      read-only; the same gate — anyone else gets a bare status,
//                                no names.
// The writers and notice workers that take the actor (src/lib/profileIdentity.ts) are plain lib code.
// 174 = 170 + 4.
// Households as profiles, Task 4: +1 in src/app/actions/households.ts, exported from the barrel.
//   createGiftRecipientProfile(input) session required; only the giver's team (owner,
//                                org-mates) or an admin, else not_authorized. Only for a gift
//                                form currently linked to that giver (else not_found); makes
//                                the profile from THAT form's stored answers (nothing typed by
//                                the caller), owned by the giver's owner; once per form
//                                (a claimed household id, then the membership's source_key).
// The unattended attach / match / gift readers (src/lib/householdPeople.ts,
// src/lib/giftRecipients.ts) are plain lib code.
// 175 = 174 + 1.
// Households as profiles, Task 8: the old household JSON actions are RETIRED (nothing reads or
// writes adopters.household_members for display or edits any more; the profile UI, the importer
// and «alguien de su hogar» use src/app/actions/households.ts). Removed with their files:
//   addHouseholdMember, updateHouseholdMember, removeHouseholdMember, addMemberContactEntry,
//   updateMemberContactEntry, removeMemberContactEntry (src/app/actions/householdMembers.ts) and
//   reportNotLivingTogether (src/app/actions/householdLinks.ts — «No vive acá» is now
//   removeHouseholdMembership(…, 'not_living')). No action added. MEASURED (npm run build): 168.
// 168 = 175 − 7.
// Households as profiles, final fix P1: +1 checkHouseholdPersonEdit (src/app/actions/households.ts)
// — «⋯ → Editar» checks name, relationship and age for changes since the form opened BEFORE saving
// any (no partial save). Signed-in only, read-only, answers field NAMES only (never the stored
// values); a stranger learns nothing they couldn't see on the profile. (S4 removed a branch of
// addHouseholdPerson, not an action.)
// 169 = 168 + 1.
const EXPECTED_ACTIONS = 169;

let manifest;
try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (e) {
    console.error(`::error::cannot read ${MANIFEST} — run \`npm run build\` first (${e.message})`);
    process.exit(1);
}

const total = ['node', 'edge'].reduce((n, scope) => n + Object.keys(manifest[scope] || {}).length, 0);

if (total === 0) {
    console.error('::error::the manifest lists no server actions at all — the build looks wrong, not clean');
    process.exit(1);
}

if (total !== EXPECTED_ACTIONS) {
    const verb = total > EXPECTED_ACTIONS ? 'gained' : 'lost';
    console.error(`::error::the browser-callable surface ${verb} ${Math.abs(total - EXPECTED_ACTIONS)} endpoint(s): ${EXPECTED_ACTIONS} expected, ${total} built.`);
    console.error('If that was deliberate, raise EXPECTED_ACTIONS in scripts/check-action-surface.mjs in the same commit,');
    console.error('having checked that each new export is safe to call with arguments a stranger chooses.');
    console.error('If it was not, something became a server action that should not be one — see src/lib/serverActionSurface.test.ts.');
    process.exit(1);
}

console.log(`server-action surface OK: ${total} browser-callable endpoints, as expected`);
