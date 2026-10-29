import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Doctor Consultation API
app.post('/api/doctor/consult', async (req: Request, res: Response) => {
  try {
    const { message, history, gestationalAge, maternalProfile } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'الرجاء إدخال سؤالك الطبي.' });
    }

    if (!ai) {
      return res.status(503).json({
        error: 'خدمة الاستشارة الطبية الذكية غير متصلة حالياً بمفتاح الخدمة. يرجى التأكد من الإعدادات.',
      });
    }

    const gaContext = gestationalAge
      ? `عمر الحمل الحالي للأم: الأسبوع ${gestationalAge.weeks} واليوم ${gestationalAge.days} (الثلث ${
          gestationalAge.weeks <= 13 ? 'الأول' : gestationalAge.weeks <= 27 ? 'الثاني' : 'الثالث'
        }).`
      : 'عمر الحمل: غير محدد بدقة.';

    const profileContext = maternalProfile
      ? `معلومات إضافية: فصيلة الدم ${maternalProfile.bloodType || 'غير محددة'}، الحمل السابق: ${
          maternalProfile.previousPregnancies || 'الأول'
        }، حالات صحية: ${maternalProfile.chronicConditions || 'لا توجد'}.`
      : '';

    const systemInstruction = `أنت "د. نبض" - طبيب واستشاري متخصص وخبير في طب النساء والتوليد ورعاية الأم والجنين (Obstetrics & Maternal-Fetal Medicine).
أنت تتحدث مع أم حامل تبحث عن الرعاية والاطمئنان والمعلومة الطبية الدقيقة الموثوقة.

السياق الإكلينيكي للأم السائلة:
${gaContext}
${profileContext}

إرشاداتك الطبية الصارمة:
1. التحدث بلغة عربية فصيحة، طبية دقيقة ومبسطة، بأسلوب طبيب رحيم، حكيم، ومهدئ للأعصاب (Bedside Manner).
2. عند الإجابة، ادمج تطورات الجنين وعمر الحمل الحالي للأم لتكون النصيحة مخصصة لها تماماً.
3. التمييز الواضح بين التغيرات الفسيولوجية الطبيعية في هذا التوقيت من الحمل وبين الحالات المرضية.
4. إبراز "علامات الخطر الطبية" (Red Flags) بلون أو تنبيه واضح إذا كانت الشكوى تشير لاحتمال:
   - نزيف مهبلي نشط أو إفرازات بنية داكنة متكررة
   - نزول ماء دافئ مستمر (تمزق مبكر للأغشية)
   - نقص مفاجئ أو توقف حركة الجنين (بعد الأسبوع 24)
   - صداع حاد مع تشوش في الإبصار وألم أعلى البطن (اشتباه تسمم حمل Pre-eclampsia)
   - حرارة مرتفعة مع قشعريرة وألم في الخاصرة
   في هذه الحالات، يجب توجيه الأم بحزم ولطف للذهاب فوراً لقسم الطوارئ / الاتصال بطبيبها المباشر.
5. تقديم حلول غذائية وحياتية عملية آمنة للمشاكل الشائعة (الغثيان، الحموضة، آلام الحوض والظهر، الإمساك، الأرق).
6. نسّق إجابتك بعناوين واضحة ونقاط مرتبة لسهولة القراءة للأم الحامل.`;

    // Construct conversation contents
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    if (Array.isArray(history) && history.length > 0) {
      for (const item of history.slice(-6)) {
        contents.push({
          role: item.role === 'model' ? 'model' : 'user',
          parts: [{ text: item.text }],
        });
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: contents as any,
      config: {
        systemInstruction,
      },
    });

    const reply = response.text || 'عذراً، لم أتمكن من صياغة الإجابة الطبية في الوقت الحالي. يرجى المحاولة مرة أخرى.';
    return res.json({ reply });
  } catch (error: any) {
    console.error('Doctor consultation error:', error);
    return res.status(500).json({
      error: 'حدث خطأ أثناء معالجة الاستشارة الطبية. يرجى المحاولة بعد لحظات.',
      details: error?.message,
    });
  }
});

// Lab / Ultrasound Report Decoder API
app.post('/api/doctor/decode-report', async (req: Request, res: Response) => {
  try {
    const { reportText, imageBase64, mimeType, gestationalWeeks } = req.body;

    if (!reportText && !imageBase64) {
      return res.status(400).json({ error: 'الرجاء إدخال نص التقرير أو إرفاق صورة السونار/التحليل.' });
    }

    if (!ai) {
      return res.status(503).json({
        error: 'خدمة قراءة التقارير الطبية غير متصلة حالياً.',
      });
    }

    const systemInstruction = `أنت طبيب استشاري خبير في قراءة تقارير السونار (Obstetric Ultrasound) والتحاليل المخبرية للحوامل (CBC, Blood Sugar, Urine Analysis, Antenatal Panel).
مهمتك:
1. شرح الرموز والمصطلحات الطبية الشائعة بلغة عربية مبسطة جداً ومطمئنة (مثل:
   - CRL: Crown-Rump Length (طول الجنين من الرأس للمقعدة)
   - BPD: Biparietal Diameter (قطر الرأس بين العظمين الجداريين)
   - HC: Head Circumference (محيط الرأس)
   - AC: Abdominal Circumference (محيط البطن)
   - FL: Femur Length (طول عظمة الفخذ)
   - EFW: Estimated Fetal Weight (الوزن التقديري للجنين)
   - FHR: Fetal Heart Rate (معدل نبض الجنين)
   - AFI: Amniotic Fluid Index (مؤشر السائل الأمينوسي / ماء الجنين)
   - Placenta: موقع المشيمة (Anterior أمامية / Posterior خلفية / Fundal علوية / Previa نازلة)
   - تحاليل الدم: Hb الهيموجلوبين ومؤشرات فقر الدم، WBC كريات الدم البيضاء والالتهابات، السكر الصائم والتراكمي).
2. مطابقة القياسات بعمر الحمل المقدر (${gestationalWeeks ? `الأسبوع ${gestationalWeeks}` : 'غير محدد'}).
3. تصنيف النتائج بوضوح: ما هو طبيعي ومطمئن، وما يتطلب مراجعة الطبيب لمناقشته.
4. إعطاء أسئلة مقترحة للأم لتسألها لطبيبها المعالج.
5. وضع تنبيه طبي قياسي: "هذا التحليل لغرض التوضيح الطبي والتثقيف، ولا يغني عن الفحص السريري المباشر لطبيبك المعالج".`;

    const parts: Array<any> = [];

    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: imageBase64.replace(/^data:image\/\w+;base64,/, ''),
        },
      });
    }

    if (reportText) {
      parts.push({
        text: `يرجى فك شفرة هذا التقرير الطبي وتحليله بالتفصيل:\n\n${reportText}`,
      });
    } else {
      parts.push({
        text: 'يرجى قراءة صورة التقرير الطبي / السونار المرفقة وشرح جميع تفاصيلها للأم الحامل.',
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: { parts } as any,
      config: {
        systemInstruction,
      },
    });

    const analysis = response.text || 'تعذر تحليل التقرير الطبي.';
    return res.json({ analysis });
  } catch (error: any) {
    console.error('Report decode error:', error);
    return res.status(500).json({
      error: 'حدث خطأ أثناء فحص التقرير الطبي.',
      details: error?.message,
    });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
