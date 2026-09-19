// Prayer Times, Qibla and Tasbih sit behind one "Prayer" button on the nav, which opens a sub-bar
// for the three of them. That grouping is structural -- it is how the nav is shaped, not something
// anyone chose -- which is why it is all that is left in this file.
//
// What used to be here was Customize Layout: every tab could be switched off, and each could be
// restricted to one home screen or the other. It was removed because it earned none of what it
// cost. Every tab had to be written twice, once for existing and once for reachable; every new
// feature had to be placed into a three-way visibility matrix before it could ship; and the thing
// it bought was a settings panel for hiding parts of a small app that is already one tap deep.
// Nothing reads the old `fortress_layout_config` key any more; it is simply left where it is rather
// than spending code to delete something inert.
export const WORSHIP_TABS = ['prayerTimes', 'qibla', 'tasbih'];
