import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const questions = [
  {
    en: "What is your gender?",
    ar: "ما هو جنسك؟",
    choices: {
      en: ["Male", "Female"],
      ar: ["ذكر", "أنثى"],
    },
  },
  {
    en: "Have you had any past injuries?",
    ar: "هل تعرضت لأي إصابات سابقة؟",
    choices: {
      en: [
        "No injuries",
        "Minor injuries (fully recovered)",
        "Previous injuries (sometimes feel pain)",
        "Serious injury",
        "Currently injured",
      ],
      ar: [
        "لا توجد إصابات",
        "إصابات طفيفة (تعافيت تماماً)",
        "إصابات سابقة (أشعر بألم أحياناً)",
        "إصابة خطيرة",
        "مصاب حالياً",
      ],
    },
  },
  {
    en: "Has a doctor ever advised you not to exercise?",
    ar: "هل نصحك ألا تتعرض للتمرين من قبل طبيب؟",
    choices: {
      en: ["No", "Yes (temporarily)", "Yes (specific exercises only)", "Yes (completely)", "Not sure"],
      ar: ["لا", "نعم (بشكل مؤقت)", "نعم (تمارين محددة فقط)", "نعم (بشكل تام)", "لست متأكداً"],
    },
  },
  {
    en: "Are you currently exercising?",
    ar: "هل تتمرن حالياً؟",
    choices: {
      en: ["Not exercising", "1–2 times/week", "3–4 times/week", "5+ times/week", "Irregular"],
      ar: ["لا أتمرين", "1-2 مرات في الأسبوع", "3-4 مرات في الأسبوع", "5+ مرات في الأسبوع", "بشكل غير منتظم"],
    },
  },
  {
    en: "How many days per week do you train?",
    ar: "كم عدد الأيام التي تتمرن فيها أسبوعياً؟",
    choices: {
      en: ["0", "1–2 days", "3–4 times/week", "5–6 days", "Daily"],
      ar: ["0", "1-2 أيام", "3-4 مرات في الأسبوع", "5-6 أيام", "يومياً"],
    },
  },
  {
    en: "What type of exercise do you do?",
    ar: "ما هو نوع التمارين التي تمارسها؟",
    choices: {
      en: ["Gym / weight training", "Cardio (running, cycling)", "Home workouts", "Sports activities", "Mixed"],
      ar: ["جيم / تمارين أوزان", "كارديو (جري، دراجات)", "تمارين منزلية", "أنشطة رياضية", "مختلط"],
    },
  },
  {
    en: "How would you rate your fitness level?",
    ar: "كيف تقيم مستواك اللياقي؟",
    choices: {
      en: ["Beginner", "Below average", "Average", "Above average", "Advanced"],
      ar: ["مبتدئ", "أقل من المتوسط", "متوسط", "أعلى من المتوسط", "متقدم"],
    },
  },
  {
    en: "What does your daily diet look like?",
    ar: "كيف تبدو نظامك الغذائي اليومي؟",
    choices: {
      en: ["Healthy and balanced", "Mixed healthy & unhealthy", "Mostly unhealthy", "Random eating habits", "Following a specific diet"],
      ar: ["صحي ومتوازن", "مختلط (صحي وغير صحي)", "غير صحي في الغالب", "عادات طعام عشوائية", "أتبع حمية غذائية معينة"],
    },
  },
  {
    en: "Are you currently taking any medications?",
    ar: "هل تتناول أي أدوية حالياً؟",
    choices: {
      en: ["No", "Yes (regularly)", "Yes (occasionally)", "Not sure", "Prefer not to say"],
      ar: ["لا", "نعم (بانتظام)", "نعم (من حين لآخر)", "لست متأكداً", "أفضل عدم الإفصاح"],
    },
  },
  {
    en: "Do you have any medical conditions?",
    ar: "هل تعاني من أي حالات طبية؟",
    choices: {
      en: ["No", "Yes (controlled)", "Yes (needs attention)", "Not sure", "Prefer not to say"],
      ar: ["لا", "نعم (متحكم بها)", "نعم (تحتاج إلى اهتمام)", "لست متأكداً", "أفضل عدم الإفصاح"],
    },
  },
  {
    en: "Why is this goal important to you?",
    ar: "لماذا يعتبر هذا الهدف مهمًا بالنسبة لك؟",
    choices: {
      en: ["Improve appearance", "Health reasons", "Increase confidence", "Sports performance", "Lifestyle change"],
      ar: ["تحسين المظهر", "أسباب صحية", "زيادة الثقة بالنفس", "الأداء الرياضي", "تغيير نمط الحياة"],
    },
  },
  {
    en: "Do you have any previous experience with personal training or fitness programs?",
    ar: "هل لديك أي خبرة سابقة مع التدريب الشخصي أو برامج اللياقة البدنية؟",
    choices: {
      en: ["1–3 months", "3–6 months", "6–12 months", "No specific timeline", "As fast as possible"],
      ar: ["1-3 أشهر", "3-6 أشهر", "6-12 شهرًا", "لا يوجد جدول زمني محدد", "في أسرع وقت ممكن"],
    },
  },
  {
    en: "What are your primary fitness goals?",
    ar: "ما هي أهدافك الأساسية في اللياقة البدنية؟",
    choices: {
      en: ["Lose weight", "Build muscle", "Improve overall fitness", "Increase strength", "Rehabilitation / injury recovery"],
      ar: ["إنقاص الوزن", "بناء العضلات", "تحسين اللياقة البدنية العامة", "زيادة القوة", "إعادة التأهيل / التعافي من الإصابات"],
    },
  },
  {
    en: "How many meals do you eat per day?",
    ar: "كم وجبة تتناولها في اليوم؟",
    choices: {
      en: ["1–2 meals", "3 meals", "4 meals", "5+ meals", "Irregular"],
      ar: ["1-2 وجبات", "3 وجبات", "4 وجبات", "5+ وجبات", "غير منتظم"],
    },
  },
  {
    en: "How much water do you drink daily?",
    ar: "كم كمية الماء التي تشربها يومياً؟",
    choices: {
      en: ["Less than 1L", "1–2L", "2–3L", "3–4L", "More than 4L"],
      ar: ["أقل من 1 لتر", "1-2 لتر", "2-3 لتر", "3-4 لتر", "أكثر من 4 لتر"],
    },
  },
  {
    en: "Do you have any food allergies or restrictions?",
    ar: "هل تعاني من أي حساسيات أو قيود غذائية؟",
    choices: {
      en: ["No", "Yes (allergies)", "Yes (diet preference)", "Yes (medical restriction)", "Not sure"],
      ar: ["لا", "نعم (حساسية)", "نعم (تفضيلات غذائية)", "نعم (قيود طبية)", "لست متأكداً"],
    },
  },
  {
    en: "How many hours do you sleep per night?",
    ar: "كم عدد ساعات النوم التي تنامها في الليلة؟",
    choices: {
      en: ["Less than 5 hours", "5–6 hours", "6–7 hours", "7–8 hours", "More than 8 hours"],
      ar: ["أقل من 5 ساعات", "5-6 ساعات", "6-7 ساعات", "7-8 ساعات", "أكثر من 8 ساعات"],
    },
  },
  {
    en: "What is your occupation?",
    ar: "ما هو عملك أو وظيفتك؟",
    choices: {
      en: ["Sedentary (desk job)", "Light activity", "Moderate activity", "Very active", "Student"],
      ar: ["خامل (وظيفة مكتبية)", "نشاط خفيف", "نشاط متوسط", "نشط للغاية", "طالب"],
    },
  },
  {
    en: "How would you rate your daily activity level?",
    ar: "ما مدى تقييمك لمستوى نشاطك اليومي؟",
    choices: {
      en: ["Very low", "Low", "Moderate", "High", "Very high"],
      ar: ["منخفض جداً", "منخفض", "متوسط", "مرتفع", "مرتفع جداً"],
    },
  },
  {
    en: "Do you smoke or drink alcohol?",
    ar: "هل تدخن أو تشرب الكحول؟",
    choices: {
      en: ["No", "Smoke only", "Drink alcohol only", "Both", "Occasionally"],
      ar: ["لا", "التدخين فقط", "شرب الكحول فقط", "كلاهما", "أحياناً"],
    },
  },
  {
    en: "How many days per week can you commit to training?",
    ar: "كم عدد الأيام في الأسبوع التي يمكنك تخصيصها للتدريب؟",
    choices: {
      en: ["1–2 days", "3–4 days", "5–6 days", "Daily", "Not sure"],
      ar: ["1-2 أيام", "3-4 أيام", "5-6 أيام", "يومياً", "لست متأكداً"],
    },
  },
  {
    en: "Do you prefer training at the gym or at home?",
    ar: "هل تفضل التمارين في الجيم أم في المنزل؟",
    choices: {
      en: ["Gym", "Home", "Both", "Outdoor", "No preference"],
      ar: ["الجيم", "المنزل", "كلاهما", "في الهواء الطلق", "بدون تفضيل"],
    },
  },
  {
    en: "What challenges do you expect to face?",
    ar: "ما هي التحديات التي تتوقع أن تواجهها؟",
    choices: {
      en: ["Lack of time", "Lack of motivation", "Nutrition issues", "Injuries / pain", "Consistency"],
      ar: ["ضيق الوقت", "قلة التحفيز", "مسايل التغذية", "الإصابات / الألم", "الاستمرارية"],
    },
  },
  {
    en: "How many hours do you training per day?",
    ar: "كم عدد الساعات التي تتمرن فيها يومياً؟",
    choices: {
      en: ["Less than 25 minutes", "30–40 minutes", "45 minutes", "1 hour", "More than 1 hour"],
      ar: ["أقل من 25 دقيقة", "30-40 دقيقة", "45 دقيقة", "ساعة واحدة", "أكثر من ساعة واحدة"],
    },
  },
];

const textQuestions: Array<{ en: string; ar: string }> = [
  {
    en: "Type Your Height",
    ar: "أدخل طولك",
  },
  {
    en: "Type Your Weight",
    ar: "أدخل وزنك",
  },
  {
    en: "Add Food You Like & Dislike",
    ar: "أضف الطعام الذي تحبه وتكرهه",
  },
];

async function main() {
  console.log("Starting seed...\n");

  // 1. Client questions (choice)
  console.log("1. Seeding client questions...");
  let questionCount = 0;
  for (const q of questions) {
    const groupKey = crypto.randomUUID();
    for (const lang of ["en", "ar"] as const) {
      await prisma.client_questions.upsert({
        where: { question_language: { question: q[lang], language: lang } },
        update: { choices: q.choices[lang], group_key: groupKey, question_type: "choice" },
        create: {
          group_key: groupKey,
          question: q[lang],
          question_type: "choice",
          choices: q.choices[lang],
          language: lang,
        },
      });
      questionCount++;
    }
  }
  console.log(`   Seeded ${questionCount} client questions (${questions.length} x 2)\n`);

  console.log("Seeding open-text questions...");
  for (const q of textQuestions) {
    const groupKey = crypto.randomUUID();
    for (const lang of ["en", "ar"] as const) {
      await prisma.client_questions.upsert({
        where: { question_language: { question: q[lang], language: lang } },
        update: { choices: [], group_key: groupKey, question_type: "text" },
        create: {
          group_key: groupKey,
          question: q[lang],
          question_type: "text",
          choices: [],
          language: lang,
        },
      });
    }
  }
  console.log("Client questions seeded successfully.\n");

  // 2. Exercises from JSON file
  console.log("2. Seeding exercises...");
  const exercisesPath = path.join(process.cwd(), "01_athletica_mvp_database_v2.json");
  if (fs.existsSync(exercisesPath)) {
    const exercisesRaw = JSON.parse(fs.readFileSync(exercisesPath, "utf-8"));
    await prisma.exercises.createMany({
      data: exercisesRaw.map((e: any) => ({
        id: e.id, name_en: e.name_en, name_ar: e.name_ar, primary_muscle: e.primary_muscle,
        secondary_muscles: e.secondary_muscles, equipment: e.equipment, difficulty: e.difficulty,
        exercise_type: e.exercise_type, classification: e.classification, movement_pattern: e.movement_pattern,
        fitness_goals: e.fitness_goals, workout_location: e.workout_location, media_type: e.media_type,
        media_url: e.media_url, video_url: e.video_url, tags: e.tags, is_default: e.is_default, priority: e.priority,
      })),
      skipDuplicates: true,
    });
    console.log(`   Seeded ${exercisesRaw.length} exercises\n`);
  } else {
    console.log("   Skipped exercises (file not found)\n");
  }

  // 3. Food categories
  console.log("3. Seeding food categories...");
  const foodPath = path.join(process.cwd(), "prisma_seed_data-1 (1).json");
  if (fs.existsSync(foodPath)) {
    const foodRaw = JSON.parse(fs.readFileSync(foodPath, "utf-8"));
    await prisma.food_categories.createMany({
      data: foodRaw.foodCategories.map((c: any) => ({
        id: c.id, name: c.name, name_en: c.name_en, name_ar: c.name_ar,
      })),
      skipDuplicates: true,
    });
    console.log(`   Seeded ${foodRaw.foodCategories.length} food categories\n`);

    // 4. Foods
    console.log("4. Seeding foods...");
    await prisma.foods.createMany({
      data: foodRaw.foods.map((f: any) => ({
        id: f.id, category_id: f.categoryId, name: f.name, name_en: f.name_en, name_ar: f.name_ar,
        base_grams: f.baseGrams, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
        serving_unit: "g", serving_unit_en: "g", serving_unit_ar: "جرام",
      })),
      skipDuplicates: true,
    });
    console.log(`   Seeded ${foodRaw.foods.length} foods\n`);
  } else {
    console.log("   Skipped food categories/foods (file not found)\n");
  }

  console.log("\nSeed completed!");
  console.log("Summary:");
  console.log(`  - ${questionCount + textQuestions.length * 2} client questions`);
  console.log("  - Workout templates skipped (require existing coach_id)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
