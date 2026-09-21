import fs from "fs";
import path from "path";

const translations: Record<string, string> = {
  "Barbell Decline Bench Press": "ضغط صدر سفلي بالبار",
  "Dips (chest Focus)": "غطس للصدر (تركيز الصدر)",
  "V-bar Pulldown": "سحب ظهر ببار V",
  "One-arm Dumbbell Row": "سحب ظهر بذراع واحدة بالدمبل",
  "Split Squat With Dumbbells": "سكوات منقسم بالدمبل",
  "Freehand Jump Squat": "سكوات قفز بدون أوزان",
  "Single Leg Glute Bridge": "جسر المؤخرة برجال واحدة",
  "One-legged Cable Kickback": "ركلة خلفية بالكابل برجال واحدة",
  "Natural Glute Ham Raise": "رفع الفخذ والخلفية الطبيعي",
  "One-arm Kettlebell Swings": "أرجحة كيتل بيل بذراع واحدة",
  "Seated Machine Calf Raise": "رفع السمانة جالس على الجهاز",
  "Calf Press On The Leg Press Machine": "ضغط السمانة على جهاز ضغط الأرجل",
  "Standing Dumbbell Calf Raise": "رفع السمانة واقف بالدمبل",
  "Standing Military Press": "ضغط أكتاف واقف بالبار (عسكري)",
  "Cable Seated Lateral Raise": "رفرفة جانبية بالكابل جالس",
  "External Rotation With Cable": "تدوير خارجي للكتف بالكابل",
  "Cable Rope Overhead Triceps Extension": "تمديد الترايسبس فوق الرأس بالحبل والكابل",
  "Dips (triceps Focus)": "غطس ترايسبس (تركيز التراي)",
  "Machine Triceps Extension": "تمديد الترايسبس على الجهاز",
  "Standing Cable Wood Chop": "تمرين تقطيع الخشب بالكابل واقف",
  "Dynamic Chest Stretch": "إطالة ديناميكية للصدر",
  "Chest And Front Of Shoulder Stretch": "إطالة الصدر وأمام الكتف",
  "Cat Stretch": "إطالة القط للظهر",
  "Upper Back Stretch": "إطالة أعلى الظهر",
  "Spinal Stretch": "إطالة العمود الفقري",
  "Shoulder Circles": "دوائر الأكتاف",
  "Seated Front Deltoid": "إطالة عضلة الكتف الأمامية جالس",
  "Overhead Triceps": "إطالة الترايسبس فوق الرأس",
  "Seated Biceps": "إطالة البايسبس جالس",
  "Kneeling Forearm Stretch": "إطالة الساعد جالس على الركبتين",
  "Lying Prone Quadriceps": "إطالة العضلة الرباعية مستلقي",
  "Kneeling Hip Flexor": "إطالة عضلات الورك جالس على الركبة",
  "Seated Hamstring": "إطالة عضلات الفخذ الخلفية جالس",
  "Standing Toe Touches": "لمس أطراف الأصابع واقف",
  "Runner's Stretch": "إطالة الجري",
  "Calf Stretch Hands Against Wall": "إطالة السمانة باليدين على الحائط",
  "Standing Hip Circles": "دوائر الورك واقف",
  "Lying Crossover": "تقاطع الأرجل مستلقي",
  "Hip Circles (prone)": "دوائر الورك (مستلقي)",
  "Groiners": "تمرين إطالة الأربطة والورك",
  "Frog Hops": "قفزات الضفدع",
  "Elbow Circles": "دوائر الكوع",
  "Shoulder Raise": "رفع الأكتاف",
  "Pelvic Tilt Into Bridge": "إمالة الحوض للجسر",
  "Torso Rotation": "تدوير الجذع",
  "Inchworm": "تمرين الدودة",
  "Side Leg Raises": "رفع الأرجل جانبي",
  "Front Leg Raises": "رفع الأرجل أمامي",
  "Standing Pelvic Tilt": "إمالة الحوض واقف",
  "Iron Crosses (stretch)": "إطالة الصليب الحديدي",
  "Scapular Pull-up": "عقلة العظام اللوحية",
  "Windmills": "تمرين الطاحونة",
  "Hug Knees To Chest": "ضم الركبتين إلى الصدر",
  "Looking At Ceiling": "إطالة الرقبة للنظر للسقف",
  "Sit Squats": "سكوات الجلوس",
  "Standing Hip Flexors": "إطالة مفصل الورك واقف",
  "Rowing, Stationary": "تمرين التجديف الثابت",
  "Rope Jumping": "نط الحبل",
  "Walking, Treadmill": "المشي على المشاية",
  "Recumbent Bike": "دراجة ثابتة مستلقية",
  "Jogging, Treadmill": "الركض على المشاية",
  "Star Jump": "قفزة النجمة",
  "Scissors Jump": "قفزة المقص",
  "Knee Tuck Jump": "قفزة ضم الركبتين",
  "Rocket Jump": "قفزة الصاروخ",
  "Lateral Bound": "قفز جانبي متتابع",
  "Prowler Sprint": "ركض دفع الزلاجة (برولر)",
  "Skating": "تمرين التزلج",
  "Step Mill": "جهاز درج السلم",
  "Seated One-arm Cable Pulley Rows": "سحب كابل جالس بذراع واحدة",
  "Standing Leg Curl": "ثني الأرجل خلفي واقف",
  "Palms-up Barbell Wrist Curl Over A Bench": "ثني الساعد بالبار أعلى الدكة",
  "Chin To Chest Stretch": "إطالة الذقن إلى الصدر",
  "Side Neck Stretch": "إطالة الرقبة الجانبية",
  "Tricep Side Stretch": "إطالة الترايسبس الجانبية",
  "Bulgarian Split Squat": "سكوات بلغاري منفصل",
  "Single-leg Calf Raise": "رفع السمانة برجال واحدة",
  "Dead Hang": "تعلق حر على العقلة",
  "Neck Flexion": "انثناء الرقبة الأمامي",
  "Neck Extension": "تمديد الرقبة الخلفي",
  "Neck Harness": "تمرين الرقبة بالحزام",
  "Machine Abductor": "جهاز إبعاد الفخذ (الأرداف الجانبية)",
  "Jefferson Curl": "ثني جيفرسون للظهر",
  "Banded Hip Thrust": "دفع الحوض بالشريط المطاطي",
  "Banded Lateral Walk": "مشي جانبي بالشريط المطاطي",
  "Banded Calf Raise": "رفع السمانة بالشريط المطاطي",
  "Banded Lat Pulldown": "سحب ظهر بالشريط المطاطي",
  "Banded Chest Press": "ضغط صدر بالشريط المطاطي",
  "Banded Overhead Press": "ضغط كتف بالشريط المطاطي",
  "Banded Internal Rotation": "تدوير داخلي للكتف بالشريط المطاطي",
  "Banded Pull Apart": "سحب بالشريط المطاطي",
  "Banded Curl": "بايسبس بالشريط المطاطي",
  "Banded Pushdown": "دفش ترايسبس بالشريط المطاطي",
  "Banded Grip Hold": "ثبات القبضة بالشريط المطاطي",
  "Banded Adduction": "تقريب الفخذ بالشريط المطاطي",
  "Banded Abduction": "إبعاد الفخذ بالشريط المطاطي",
  "Banded Neck Flexion": "انثناء الرقبة بالشريط المطاطي",
  "Couch Stretch": "إطالة الأريكة للفخذ والورك",
  "Seated Toe Touch": "لمس الأصابع جالس",
  "Figure 4 Stretch": "إطالة شكل رقم 4 للورك",
  "Pigeon Stretch": "إطالة الحمامة للورك",
  "Wall Calf Stretch": "إطالة السمانة على الحائط",
  "Cat-Cow": "تمرين القط والبقرة للظهر",
  "Knee to Chest Stretch": "إطالة الركبة إلى الصدر",
  "Spinal Twist": "التواء العمود الفقري",
  "Doorway Chest Stretch": "إطالة الصدر عند مدخل الباب",
  "Sleeper Stretch": "إطالة السليبر للكتف",
  "Wall Biceps Stretch": "إطالة البايسبس على الحائط",
  "Wrist Flexor Stretch": "إطالة عضلات ثني الساعد",
  "Wrist Extensor Stretch": "إطالة عضلات تمديد الساعد",
  "Cobra Stretch": "إطالة الكوبرا للبطن والظهر",
  "Butterfly Stretch": "إطالة الفراشة للفخذ الداخلي",
  "Frog Stretch": "إطالة الضفدع للحوض",
  "Standing IT Band Stretch": "إطالة الشريط الحرقفي الساقي واقف",
  "Neck Flexion Stretch": "إطالة انثناء الرقبة",
};

function kebab(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const R2_BASE =
  process.env.EXERCISE_MEDIA_BASE ||
  "https://pub-585d42eb1aa64a67aedf483ec328d3fe.r2.dev";

function build() {
  const inputPath = path.join(process.cwd(), "01_athletica_mvp_database_v2.json");
  const outputPath = path.join(process.cwd(), "exercises.json");

  const items = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

  const updated = items.map((item: any) => {
    const name_en = item.name_en;
    let name_ar = item.name_ar;

    if (!name_ar || name_ar === name_en) {
      name_ar = translations[name_en] || name_en;
    }

    const slug = kebab(name_en);
    // R2-only: full URLs, kebab-case filenames
    const media_url = `${R2_BASE}/exercise-posters/male/${slug}.jpg`;
    const thumbnail_url = media_url;
    const video_url = `${R2_BASE}/exercise-videos/male/${slug}.mp4`;

    return {
      ...item,
      name_en,
      name_ar,
      media_url,
      thumbnail_url,
      video_url,
    };
  });

  fs.writeFileSync(outputPath, JSON.stringify(updated, null, 2), "utf-8");
  console.log(`Successfully generated ${updated.length} exercises into ${outputPath}`);
}

build();
