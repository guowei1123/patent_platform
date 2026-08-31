import {
  FileText,
  Search,
  Type,
  FileOutput,
  Tag,
  Sparkles,
  Image,
  Binary,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";

export interface TestMenuItem {
  title: string;
  url?: string;
  icon?: React.ComponentType<{ className?: string }>;
  items?: TestMenuItem[];
}

export const testConfig: TestMenuItem[] = [
  {
    title: "专利交底书",
    icon: FileText,
    items: [
      {
        title: "技术背景生成",
        url: "/test/disclosure/background-generation",
        icon: Type,
      },
      {
        title: "技术方案优化",
        url: "/test/disclosure/proposal-text-optimization",
        icon: Sparkles,
      },
      {
        title: "关键词解释",
        url: "/test/disclosure/explanation-of-keywords",
        icon: Search,
      },
      {
        title: "图片检测",
        url: "/test/disclosure/image-detection",
        icon: Image,
      },
      {
        title: "问题检测",
        url: "/test/disclosure/problem-detection",
        icon: AlertTriangle,
      },
      {
        title: "有益效果生成",
        url: "/test/disclosure/beneficial-effect-generation",
        icon: Sparkles,
      },
      {
        title: "预保护点生成",
        url: "/test/disclosure/pre-protection-point-generation",
        icon: Sparkles,
      },
      {
        title: "交底书模板导出",
        url: "/test/disclosure/template-export",
        icon: FileOutput,
      },
    ],
  },
  {
    title: "专利检索报告",
    icon: FileText,
    items: [
      {
        title: "专利检索",
        url: "/test/report/patent-search",
        icon: Search,
      },
      {
        title: "关键词推荐",
        url: "/test/report/keyword-recommendation",
        icon: Tag,
      },
      {
        title: "关键词聚类",
        url: "/test/report/keyword-clustering",
        icon: Tag,
      },
      {
        title: "专利检索式生成",
        url: "/test/report/search-formula-generation",
        icon: Search,
      },
      {
        title: "报告结论生成",
        url: "/test/report/conclusion-generation",
        icon: FileOutput,
      },
      {
        title: "检索报告模板导出",
        url: "/test/report/template-export",
        icon: AlertTriangle,
      },
      {
        title: "提案分级规则判定",
        url: "/test/report/proposal-grade-evaluation",
        icon: Sparkles,
      },
      {
        title: "交底书解析",
        url: "/test/report/disclosure-parse",
        icon: FileText,
      },
      {
        title: "对比文献 X/Y/A 分类",
        url: "/test/report/document-relevance-classification",
        icon: FileText,
      },
    ],
  },
  {
    title: "专利知识问答",
    icon: MessageSquare,
    items: [
      {
        title: "通用问答",
        url: "/test/qa",
        icon: FileText,
      },
    ],
  },
  {
    title: "通用服务",
    icon: Sparkles,
    items: [
      {
        title: "Embedding 测试",
        url: "/test/common/embedding",
        icon: Binary,
      },
      {
        title: "IPC 列表",
        url: "/test/common/ipc",
        icon: Binary,
      },
      {
        title: "OSS 文件管理",
        url: "/test/common/oss",
        icon: Binary, // Using Binary icon as placeholder, or could use Folder/FileText
      },
    ],
  },
];
