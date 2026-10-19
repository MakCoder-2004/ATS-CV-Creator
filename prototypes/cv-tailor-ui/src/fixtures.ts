// THROWAWAY fixtures. Reference-derived facts + fictional jobs. Not an approved PDF import.
export type Paragraph = {
  id: string;
  section: 'Experience' | 'Projects';
  title: string;
  organization?: string;
  date?: string;
  location?: string;
  text: string;
  sourceIds: string[];
  why: string;
};
export type Evidence = { id: string; label: string; text: string; revision: number };
export type Job = { id: string; title: string; company: string; description: string; status: string };

export const jobFixture: Job[] = [
  { id: 'job-ml', title: 'Machine Learning Engineer', company: 'Northstar Labs', status: 'In review', description: 'Build computer vision models and inference APIs using Python, TensorFlow, OpenCV, Docker and FastAPI. Required: model evaluation, transfer learning, and collaboration with software engineers. Preferred: Kubernetes and production model monitoring.' },
  { id: 'job-cv', title: 'Computer Vision Engineer', company: 'Fieldwork', status: 'Saved', description: 'Develop real-time image classification and detection pipelines with Python, TensorFlow and OpenCV. Evaluate computer vision models and optimize batch inference. Preferred: experience with edge deployment.' },
  { id: 'job-ai', title: 'AI Application Engineer', company: 'Orbit Studio', status: 'Saved', description: 'Build full-stack AI applications and integrate third-party APIs. Work with Python, JavaScript, LangChain and vector databases. Preferred: enterprise Kubernetes operations.' },
];

export const paragraphFixture: Paragraph[] = [
  { id: 'exp-software', section: 'Experience', title: 'Software Engineer', organization: 'QovaTech', date: 'Dec 2025 – Present', location: 'Remote', text: 'Contribute to scalable full-stack web applications, integrate third-party APIs, and optimize backend workflows while supporting deployment pipelines and AI-driven production features.', sourceIds: ['src-software'], why: 'Connects API integration and production AI features with the posting’s inference-platform work. It does not imply ownership of ML infrastructure.' },
  { id: 'exp-ml', section: 'Experience', title: 'Machine Learning Trainee', organization: 'National Telecommunication Institute', date: 'Aug – Sep 2025', location: 'Online', text: 'Completed a 120-hour machine learning program with hands-on Python, Scikit-learn, and TensorFlow model development across NLP and computer vision tasks.', sourceIds: ['src-ml'], why: 'Direct evidence for Python, TensorFlow, model development, and computer vision. The training remains labeled as training, not professional employment.' },
  { id: 'exp-cp', section: 'Experience', title: 'Competitive Programming Trainee', organization: 'Coach Academy', date: 'May – Oct 2024', location: 'Online', text: 'Solved 100+ competitive programming problems while developing algorithmic thinking, data structures, and analytical optimization skills through coached training.', sourceIds: ['src-cp'], why: 'Supports algorithmic problem-solving. Kept shorter than the directly relevant machine learning work.' },
  { id: 'project-parking', section: 'Projects', title: 'Parking Spots Detection', text: 'Developed a real-time parking-space classification system using a fine-tuned ResNet50 with TensorFlow/Keras. Integrated OpenCV video processing, motion detection, batch inference, and GPU acceleration to visualize parking availability.', sourceIds: ['src-parking'], why: 'The strongest match for transfer learning, computer vision, TensorFlow, and real-time batch inference.' },
  { id: 'project-dino', section: 'Projects', title: 'Dino Chrome Game Using Hand Gestures', text: 'Developed a Python Dino Runner game controlled by real-time hand gestures using OpenCV and MediaPipe, with keyboard fallback and a standalone Windows executable packaged using PyInstaller.', sourceIds: ['src-dino'], why: 'Shows applied Python, OpenCV, and real-time processing without claiming experience with production model serving.' },
  { id: 'project-browser', section: 'Projects', title: 'Training And Predicting Real Time Captures on Web', text: 'Built a browser-based image classifier using TensorFlow.js and MobileNet transfer learning, with webcam data collection, custom class training, live predictions, and model export in a responsive JavaScript interface.', sourceIds: ['src-browser'], why: 'Supports transfer learning and interactive inference. Browser execution is not represented as cloud deployment.' },
];

export const evidenceFixture: Evidence[] = [
  { id: 'src-software', revision: 1, label: 'QovaTech · Software Engineer', text: 'Software engineer contributing to building scalable full-stack web applications focused on performance, reliability, and maintainable system design. Worked on integrating third-party APIs and optimizing backend workflows while supporting deployment pipelines and AI-driven production features.' },
  { id: 'src-ml', revision: 1, label: 'NTI · Machine Learning Trainee', text: 'Completed a 120-hour intensive machine learning program covering core ML concepts, deep learning fundamentals, and applied model development. Gained hands-on experience building and deploying models using Python, Scikit-learn, and TensorFlow across NLP and computer vision tasks.' },
  { id: 'src-cp', revision: 1, label: 'Coach Academy · Training', text: 'Developed strong algorithmic thinking through advanced data structures and solving 100+ competitive programming problems under expert coaching. Strengthened analytical and optimization skills directly applicable to machine learning and system design.' },
  { id: 'src-parking', revision: 1, label: 'Parking Spots Detection · Description', text: 'Developed a real-time parking spot detection system using a fine-tuned ResNet50 model with TensorFlow/Keras to classify parking spaces as occupied or empty. Integrated OpenCV-based video processing with motion detection and batch inference for optimized real-time performance, along with GPU acceleration and annotated video output for live parking availability visualization.' },
  { id: 'src-dino', revision: 1, label: 'Dino Game · Description', text: 'Developed a Python-based Dino Runner game controlled by real-time hand gestures using OpenCV and MediaPipe, with keyboard fallback, and packaged it as a standalone Windows executable using PyInstaller.' },
  { id: 'src-browser', revision: 1, label: 'Browser Classifier · Description', text: 'Built a real-time browser-based image classifier using TensorFlow.js with webcam data collection, enabling in-browser transfer learning on MobileNet for custom class training, live predictions, and model export, all running client-side with a responsive JavaScript UI.' },
];

export const skillsFixture = [
  { category: 'ML Engineering', items: ['Machine Learning', 'Model Evaluation', 'Fine-Tuning', 'Transfer Learning'] },
  { category: 'Computer Vision', items: ['Image Classification', 'Object Detection', 'Image Segmentation'] },
  { category: 'Frameworks & Libraries', items: ['TensorFlow', 'Scikit-learn', 'OpenCV', 'MediaPipe', 'NumPy'] },
  { category: 'Deployment & MLOps', items: ['Docker', 'FastAPI', 'REST APIs', 'Azure ML'] },
  { category: 'Languages', items: ['Python', 'C++', 'JavaScript', 'SQL'] },
  { category: 'Tools & Platforms', items: ['Git', 'GitHub', 'Jupyter', 'Google Colab'] },
];
export const certificatesFixture = [
  'TensorFlow: Data and Deployment — DeepLearning.AI',
  'TensorFlow Developer — DeepLearning.AI',
  'Deep Learning Specialization — DeepLearning.AI',
  'Machine Learning Specialization — Stanford University and DeepLearning.AI',
];
export const graphSteps = ['Parse posting', 'Score evidence', 'Select content', 'Tailor paragraphs', 'Verify claims', 'Check document'];
export const variants = [
  { key: 'A', name: 'Workbench', question: 'Does persistent job and evidence context make review faster?' },
  { key: 'B', name: 'Guided desk', question: 'Does one focused task at a time make the workflow clearer?' },
  { key: 'C', name: 'Review room', question: 'Should the document and its supporting evidence be the main workspace?' },
] as const;
export const scenarioLabels = {
  ready: 'Ready for review', blocked: 'Unsupported claim', overflow: 'Page overflow', stale: 'Changed source',
  'rate-limit': '429 / retry', offline: 'Offline / resume', budget: 'Run budget reached', empty: 'Empty workspace',
};
export type Scenario = keyof typeof scenarioLabels;
