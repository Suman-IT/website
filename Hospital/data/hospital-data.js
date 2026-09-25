/*
 * EDIT THIS FILE FIRST when the demo becomes a real website.
 * Replace demo values with verified details supplied by the nursing home.
 * Keep the rest of the site unchanged: sections read from this object.
 */
window.hospitalData = {
  hospitalName: "Dr. Das Nursing Home",
  shortName: "Dr. Das",
  tagline: "Quality healthcare, close to home",
  demoNotice: "DEMO TEMPLATE - Replace placeholder information before publishing",
  address: "[Full street address], [Landmark], [City], [State] - [PIN]",
  phone: "+91 00000 00000",
  whatsapp: "910000000000",
  email: "hello@example.com",
  openingHours: "Mon - Sun | Hours to be confirmed",
  emergencyNumber: "+91 00000 00000",
  googleMapsUrl: "https://maps.google.com/?q=Dr+Das+Nursing+Home",
  googleMapsEmbed: "https://www.google.com/maps?q=India&output=embed",
  rating: "5.0",
  reviewCount: "XX",
  googleReviewsUrl: "https://www.google.com/maps",
  aboutText: "Dr. Das Nursing Home is presented here as a welcoming local healthcare destination. Use this editable introduction to describe the nursing home's approach, neighbourhood, and verified areas of care once the owner approves the content.",
  stats: ["XX+ Years", "XX Doctors", "XX Beds", "XX+ Patients"],
  socialLinks: { facebook: "https://www.facebook.com/", instagram: "https://www.instagram.com/", youtube: "#" },
  trustItems: [
    { icon: "01", title: "Family-first care", note: "Demo value" },
    { icon: "02", title: "Experienced doctors", note: "Details to verify" },
    { icon: "03", title: "Pathology services", note: "Demo availability" },
    { icon: "04", title: "Convenient location", note: "Address to update" }
  ],
  departments: ["All Departments", "General Medicine", "General Surgery", "Gynecology", "Pediatrics", "Orthopedics", "Cardiology Consultation"],
  services: [
    { icon: "＋", name: "General Medicine", description: "Everyday consultations and ongoing health guidance.", department: "General Medicine" },
    { icon: "✚", name: "General Surgery", description: "Discuss surgical care pathways with the clinical team.", department: "General Surgery" },
    { icon: "◌", name: "Gynecology", description: "Dedicated women's health consultation information.", department: "Gynecology" },
    { icon: "♧", name: "Pediatrics", description: "A gentle place to ask about children's healthcare.", department: "Pediatrics" },
    { icon: "⌁", name: "Orthopedics", description: "Consultation information for bones, joints, and mobility.", department: "Orthopedics" },
    { icon: "♡", name: "Cardiology Consultation", description: "Cardiology consultation listing for demo purposes.", department: "Cardiology Consultation" },
    { icon: "▣", name: "Pathology", description: "Editable list of sample laboratory services.", department: "Pathology" },
    { icon: "⌕", name: "Diagnostics", description: "Editable diagnostic service categories.", department: "Diagnostics" },
    { icon: "＋", name: "Pharmacy", description: "Availability to be confirmed by the nursing home.", department: "Pharmacy" }
  ],
  doctors: [
    { name: "Dr. [Name]", specialty: "General Medicine", qualification: "[Qualification]", experience: "[XX] years experience", days: "Days to be confirmed", hours: "Hours to be confirmed", fee: "₹XXX", initials: "DN" },
    { name: "Dr. [Name]", specialty: "Gynecology", qualification: "[Qualification]", experience: "[XX] years experience", days: "Days to be confirmed", hours: "Hours to be confirmed", fee: "₹XXX", initials: "DR" },
    { name: "Dr. [Name]", specialty: "Orthopedics", qualification: "[Qualification]", experience: "[XX] years experience", days: "Days to be confirmed", hours: "Hours to be confirmed", fee: "₹XXX", initials: "DS" }
  ],
  pathologyTests: [
    { name: "CBC", category: "Blood Tests", price: "₹XXX", discount: "", preparation: "Preparation to be confirmed", delivery: "Report time to be confirmed" },
    { name: "Thyroid Profile", category: "Thyroid Tests", price: "₹XXX", discount: "", preparation: "Preparation to be confirmed", delivery: "Report time to be confirmed" },
    { name: "Blood Sugar", category: "Diabetes Tests", price: "₹XXX", discount: "", preparation: "Fasting requirement to be confirmed", delivery: "Report time to be confirmed" },
    { name: "Liver Function Test", category: "Liver Function Tests", price: "₹XXX", discount: "", preparation: "Preparation to be confirmed", delivery: "Report time to be confirmed" },
    { name: "Kidney Function Test", category: "Kidney Function Tests", price: "₹XXX", discount: "", preparation: "Preparation to be confirmed", delivery: "Report time to be confirmed" },
    { name: "Lipid Profile", category: "Blood Tests", price: "₹XXX", discount: "", preparation: "Preparation to be confirmed", delivery: "Report time to be confirmed" },
    { name: "ECG", category: "Diagnostics", price: "₹XXX", discount: "", preparation: "Preparation to be confirmed", delivery: "Report time to be confirmed" },
    { name: "X-Ray", category: "Diagnostics", price: "₹XXX", discount: "", preparation: "Preparation to be confirmed", delivery: "Report time to be confirmed" }
  ],
  prices: [
    { category: "Doctor Consultation", service: "General Consultation", price: "₹XXX", notes: "Demo price" },
    { category: "Doctor Consultation", service: "Specialist Consultation", price: "₹XXX", notes: "Demo price" },
    { category: "Pathology", service: "CBC", price: "₹XXX", notes: "Demo price" },
    { category: "Pathology", service: "Thyroid Profile", price: "₹XXX", notes: "Demo price" },
    { category: "Diagnostics", service: "ECG", price: "₹XXX", notes: "Demo price" },
    { category: "Room Charges", service: "General Bed", price: "₹XXX/day", notes: "Demo price" }
  ],
  facilities: [
    { icon: "▤", name: "Patient Rooms", note: "Details to verify" }, { icon: "＋", name: "Pharmacy", note: "Demo listing" },
    { icon: "⌁", name: "Pathology", note: "Demo listing" }, { icon: "⌕", name: "Diagnostics", note: "Demo listing" },
    { icon: "◫", name: "Waiting Area", note: "Details to verify" }, { icon: "↗", name: "Ambulance*", note: "Confirm availability" },
    { icon: "!", name: "Emergency Support*", note: "Confirm availability" }, { icon: "P", name: "Parking*", note: "Confirm availability" },
    { icon: "◈", name: "Cashless / Insurance*", note: "Confirm availability" }
  ],
  reviews: [
    { rating: 5, name: "Demo reviewer", text: "This is an example testimonial layout. Replace it only with an approved, genuine review.", date: "Demo content" },
    { rating: 5, name: "Patient family placeholder", text: "A placeholder for a verified patient or family experience, subject to permission.", date: "Demo content" },
    { rating: 4, name: "Local visitor placeholder", text: "Use this space for a publicly available review with its source and date.", date: "Demo content" }
  ]
};
