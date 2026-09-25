-- Starter catalogue for the Dr. Das Nursing Home demo.
-- Prices are intentionally NULL because no prices were supplied.
ALTER TABLE doctors
  ADD specialty VARCHAR(150) NULL,
  ADD qualifications VARCHAR(255) NULL;

INSERT INTO departments (hospital_id, name, slug, is_published)
SELECT h.id, seed.name, seed.slug, TRUE
FROM hospitals h
JOIN (
  SELECT 'Gynaecology' AS name, 'gynaecology' AS slug
  UNION ALL SELECT 'Paediatrics', 'paediatrics'
  UNION ALL SELECT 'Dermatology', 'dermatology'
  UNION ALL SELECT 'Neurology & Neurosurgery', 'neurology-neurosurgery'
  UNION ALL SELECT 'General & Laparoscopic Surgery', 'general-laparoscopic-surgery'
  UNION ALL SELECT 'Diagnostics & Laboratory', 'diagnostics-laboratory'
) seed
WHERE NOT EXISTS (
  SELECT 1 FROM departments d WHERE d.hospital_id = h.id AND d.slug = seed.slug
);

INSERT INTO doctors (hospital_id, display_name, slug, specialty, qualifications, is_active, is_published)
SELECT h.id, seed.display_name, seed.slug, seed.specialty, seed.qualifications, TRUE, TRUE
FROM hospitals h
JOIN (
  SELECT 'Dr. Sudip Chandra Saha' AS display_name, 'dr-sudip-chandra-saha' AS slug,
    'Gynaecologist' AS specialty, 'MBBS, DGO, MD (Cal.)' AS qualifications
  UNION ALL SELECT 'Dr. Chandan Shamsul', 'dr-chandan-shamsul', 'Gynaecologist', 'MBBS (Cal.), DNB (Pondicherry), MNAMS'
  UNION ALL SELECT 'Dr. Anuradha Malik', 'dr-anuradha-malik', 'Gynaecologist', 'MBBS (Gold Medalist), MS (Obst. & Gynae.), FMAS, Diploma in Laparoscopy (Germany)'
  UNION ALL SELECT 'Dr. Sanjay Kumar Patra', 'dr-sanjay-kumar-patra', 'Gynaecologist', 'MBBS (Cal.), MS (Obst. & Gynae.)'
  UNION ALL SELECT 'Dr. Sudip Bhattacharya', 'dr-sudip-bhattacharya', 'Gynaecologist', 'MBBS (Cal.), DNB, DGO'
  UNION ALL SELECT 'Dr. Shweta Ghosh', 'dr-shweta-ghosh', 'Gynaecologist', 'MBBS, MS (Obst. & Gynae.)'
  UNION ALL SELECT 'Dr. Sudipa Mondal', 'dr-sudipa-mondal', 'Gynaecologist', 'MBBS, MS (Obst. & Gynae.)'
  UNION ALL SELECT 'Dr. Chinmoy Haldar', 'dr-chinmoy-haldar', 'Dermatologist', 'MBBS, MD (Derma) (Cal.)'
  UNION ALL SELECT 'Dr. Tathagata Dutta', 'dr-tathagata-dutta', 'Neurologist / Neurosurgeon', 'MBBS, DNB (General Surgery), MRCS Glasgow (United Kingdom)'
  UNION ALL SELECT 'Dr. Pronendu Pal', 'dr-pronendu-pal', 'General & Laparoscopic Surgeon', 'MBBS, MS (General Surgery), FMAS'
) seed
WHERE NOT EXISTS (SELECT 1 FROM doctors d WHERE d.hospital_id = h.id AND d.slug = seed.slug);

INSERT INTO doctor_departments (hospital_id, doctor_id, department_id)
SELECT h.id, d.id, dep.id
FROM hospitals h
JOIN doctors d ON d.hospital_id = h.id
JOIN departments dep ON dep.hospital_id = h.id
WHERE ((d.slug IN ('dr-sudip-chandra-saha', 'dr-chandan-shamsul', 'dr-anuradha-malik',
                   'dr-sanjay-kumar-patra', 'dr-sudip-bhattacharya', 'dr-shweta-ghosh',
                   'dr-sudipa-mondal') AND dep.slug = 'gynaecology')
   OR (d.slug = 'dr-chinmoy-haldar' AND dep.slug = 'dermatology')
   OR (d.slug = 'dr-tathagata-dutta' AND dep.slug = 'neurology-neurosurgery')
   OR (d.slug = 'dr-pronendu-pal' AND dep.slug = 'general-laparoscopic-surgery'))
  AND NOT EXISTS (
    SELECT 1 FROM doctor_departments link
    WHERE link.hospital_id = h.id AND link.doctor_id = d.id AND link.department_id = dep.id
  );

INSERT INTO diagnostic_services (hospital_id, name, slug, category, description, price, price_note, is_published)
SELECT h.id, seed.name, seed.slug, seed.category, seed.description, NULL, 'Contact the centre', TRUE
FROM hospitals h
JOIN (
  SELECT 'ECG' AS name, 'ecg' AS slug, 'Cardiology diagnostics' AS category, 'Electrocardiogram test.' AS description
  UNION ALL SELECT 'USG / Ultrasound', 'usg-ultrasound', 'Imaging', 'Ultrasonography services.'
  UNION ALL SELECT 'CT Scan', 'ct-scan', 'Imaging', 'Computed tomography imaging.'
  UNION ALL SELECT 'MRI', 'mri', 'Imaging', 'Magnetic resonance imaging.'
  UNION ALL SELECT 'Blood Tests', 'blood-tests', 'Laboratory', 'Routine and diagnostic blood investigations.'
) seed
WHERE NOT EXISTS (SELECT 1 FROM diagnostic_services s WHERE s.hospital_id = h.id AND s.slug = seed.slug);
