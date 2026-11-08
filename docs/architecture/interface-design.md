# Staff interface design

The first user is a service advisor at reception. They need to identify a vehicle, record the customer's wording, see missing intake evidence and raise a concern without confusing a saved draft with authorised work. A controller needs to scan the same queue for held work. Technicians later need large, direct actions on a workshop tablet.

Use a neutral workshop desk palette with charcoal navigation, a pale main canvas, white work surfaces and emerald for ordinary actions. Amber and red describe attention and safety states. Use readable system sans-serif text and tabular numerals for work-order references, counts and timestamps. Do not add ornamental charts, gradients, animation or fabricated business metrics.

On a workstation, place a compact site identity and primary work areas in the left navigation, the current queue in the main panel, and work-order detail on its own route. On narrow screens use a simple top navigation, stacked rows and full-width forms. Keep touch targets at least 44 pixels, labels visible, keyboard focus clear and long VINs wrap-safe. Avoid draggable-only interactions.

The reception queue shows actual API totals, a search field, records with reference, vehicle, customer, complaint count and hold count, and one clear intake action. Empty state opens the intake form. Loading, authentication expiry, permission denial, conflict, failed request and lost connection all have explicit visible states. A failed request never substitutes sample data.

The work-order screen keeps complaint lines, planned tasks, open holds and the five gate requirements distinct. Gate labels always state their evidence status. There is no technical-release control until the server command and authority checks exist. A hold shows its category, scope, owner, observation and reason. A task hold does not visually mark every unrelated task as blocked.

The intake form labels persisted results as reception drafts. Saving the draft cannot be described as accepting custody or authorising repair. Customer wording is a textarea. VIN input uses a workshop-friendly format and server validation. Duplicate VIN errors keep the entered content and explain that an existing-record selection is required.

Local draft persistence is opt-in for the current account and site and visibly labelled as stored in this tab. After the advisor chooses **Save in this tab**, later edits update that session-only draft automatically. Sign-out clears accessible draft state. Browser-storage failure is an inline error. Submission keeps its command ID across retry. Do not add a modal where a full page or inline section keeps context clearer.

Future work areas appear only when implemented and authorised. The implementation tracker, rather than disabled product navigation, describes unfinished scope. Initial screens must remain useful without implying the other modules already work.
