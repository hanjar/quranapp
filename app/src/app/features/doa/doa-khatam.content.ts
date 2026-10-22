/**
 * Doa khatam Al-Qur'an, short version (curated 23 Okt 2026, see docs/DECISIONS.md D29).
 * The Arabic text matched across independent answers (GPT, Gemini) and Indonesian
 * references; not yet reviewed by LPMQ. This is a supplication, not Qur'an text:
 * it is never rendered inside the mushaf frame.
 */
export interface DoaLine {
  arabic: string;
  latin: string;
  translation: string;
}

export const DOA_KHATAM_TITLE = "Doa Khatam Al-Qur'an";

export const DOA_KHATAM: readonly DoaLine[] = [
  {
    arabic: 'اللَّهُمَّ ارْحَمْنِي بِالْقُرْآنِ، وَاجْعَلْهُ لِي إِمَامًا وَنُورًا وَهُدًى وَرَحْمَةً',
    latin: 'Allāhummarḥamnī bil-qur’ān(i), waj‘alhu lī imāmaw wa nūraw wa hudaw wa raḥmah.',
    translation:
      'Ya Allah, rahmatilah aku dengan Al-Qur’an, dan jadikanlah ia bagiku pemimpin, cahaya, petunjuk, dan rahmat.',
  },
  {
    arabic: 'اللَّهُمَّ ذَكِّرْنِي مِنْهُ مَا نَسِيتُ، وَعَلِّمْنِي مِنْهُ مَا جَهِلْتُ',
    latin: 'Allāhumma żakkirnī minhu mā nasītu, wa ‘allimnī minhu mā jahiltu,',
    translation:
      'Ya Allah, ingatkanlah aku apa yang terlupa darinya, dan ajarkanlah kepadaku apa yang belum kuketahui darinya.',
  },
  {
    arabic: 'وَارْزُقْنِي تِلَاوَتَهُ آنَاءَ اللَّيْلِ وَأَطْرَافَ النَّهَارِ، وَاجْعَلْهُ لِي حُجَّةً يَا رَبَّ الْعَالَمِينَ',
    latin: 'warzuqnī tilāwatahū ānā’al-laili wa aṭrāfan-nahār(i), waj‘alhu lī ḥujjatan yā rabbal-‘ālamīn(a).',
    translation:
      'Karuniakanlah kepadaku (kemampuan) membacanya pada waktu malam dan di ujung-ujung siang, dan jadikanlah ia hujah (pembela) bagiku, wahai Tuhan semesta alam.',
  },
];

/** Shown under the doa: where it comes from and what it is not. */
export const DOA_KHATAM_SOURCE =
  'Doa yang masyhur dibaca setelah khatam, dinukil Imam al-Ghazali dalam Iḥyā’ ‘Ulūm ad-Dīn (Adab Tilawah). ' +
  'Al-Hafiz al-‘Iraqi dalam takhrij Ihya’ (1/369) menilai riwayatnya mu‘ḍal (sanadnya terputus), ' +
  'jadi bukan hadis sahih dari Nabi ﷺ. Dibaca sebagai doa yang baik, bukan bagian dari Al-Qur’an.';
