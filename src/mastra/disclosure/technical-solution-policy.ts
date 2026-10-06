import type { DisclosureState, ModelResult } from "./contracts";

export class TechnicalSolutionPolicyError extends Error {}

export const technicalSolutionInputLabel = "用户编辑：technicalSolution";
export const technicalSolutionReminder =
  "请补充核心技术方案的具体组成、实现步骤或连接关系。";

/** 逐字校验整组引文；任何伪造、重复或乱序引用都不能成为方案正文。 */
export function resolveTechnicalSolutionQuotes(
  state: DisclosureState,
  quotes: DisclosureState["technicalSolutionQuotes"],
): string {
  if (!quotes?.length) return "";
  let previousSource = -1;
  let previousEnd = -1;
  const parts: string[] = [];
  for (const item of quotes) {
    const sourceIndex = state.sources.findIndex(
      (source) => source.id === item.sourceId,
    );
    if (sourceIndex < 0 || sourceIndex < previousSource) return "";
    const source = state.sources[sourceIndex];
    const start = source.text.indexOf(
      item.quote,
      sourceIndex === previousSource ? previousEnd : 0,
    );
    if (start < 0) return "";
    previousSource = sourceIndex;
    previousEnd = start + item.quote.length;
    parts.push(item.quote);
  }
  const text = parts.join("\n");
  return text.length <= 40000 ? text : "";
}

/** 仅信任用户编辑原文或用户材料的逐字引文，不信任历史 AI 正文。 */
export function getUserTechnicalSolution(state: DisclosureState): string {
  const manual = state.sources.findLast(
    (source) => source.label === technicalSolutionInputLabel,
  );
  if (manual?.text) return manual.text;
  if (
    manual &&
    !state.technicalSolutionQuotes?.every(
      (item) =>
        state.sources.findIndex((source) => source.id === item.sourceId) >
        state.sources.indexOf(manual),
    )
  )
    return "";
  return resolveTechnicalSolutionQuotes(state, state.technicalSolutionQuotes);
}

/** 材料整理只能复制可核验的用户原文，不能通过章节补丁生成核心方案。 */
export function applyExtractedUserSolution(
  state: DisclosureState,
  result: ModelResult,
): DisclosureState {
  const manual = state.sources.findLast(
    (source) => source.label === technicalSolutionInputLabel,
  );
  if (manual?.text) return state;
  if (
    manual &&
    !result.technicalSolutionQuotes?.every(
      (item) =>
        state.sources.findIndex((source) => source.id === item.sourceId) >
        state.sources.indexOf(manual),
    )
  )
    return state;
  const text = resolveTechnicalSolutionQuotes(
    state,
    result.technicalSolutionQuotes,
  );
  if (!text) return state;
  return {
    ...state,
    technicalSolutionQuotes: result.technicalSolutionQuotes,
    solutionBlocks:
      state.solutionBlocks?.map((block) => block.content).join("\n") === text
        ? state.solutionBlocks
        : [{ id: "solution", content: text }],
    sections: { ...state.sections, technicalSolution: text },
  };
}

export function inspectTechnicalSolution(text: string) {
  const content = text.trim();
  if (!content)
    return {
      ready: false,
      message: `材料中未找到核心技术方案。${technicalSolutionReminder}`,
    };
  const concreteAction =
    /采集|检测|读取|接收|计算|比较|判断|调节|控制|输出|发送|连接|安装|固定|传输|识别|过滤|转换|存储|匹配|混合|加热|冷却|压制|成型|反应|切换|驱动|输入|处理|排序|训练|编码|解码|焊接|装配|合成|提取|生成/;
  const concreteObject =
    /传感器|控制器|处理器|模块|模组|电池|电机|泵|阀|管|板|轴|壳|电路|接口|数据|信号|温度|压力|流量|图像|文本|特征|参数|阈值|记录|文件|请求|材料|溶液|原料|输入|输出|节点|设备|部件|组件|样本|模型|网络|电压|电流|转速|通道/;
  const implementation = content
    .replace(
      /(?:从而|以便|旨在|实现智能|实现高效|提升效率|提高效率|提高可靠性|改善体验)[\s\S]*/g,
      "",
    )
    .replace(
      /AI|智能化?|先进|创新|高效|可靠|自动化?|系统|技术|方案|功能|算法|进行|对|的|实现|采用|使用|通过|以及|并且|[\s，。；、,.!?！？:：]/g,
      "",
    );
  const vague =
    content.replace(/[\s，。；、,.!?！？:：]/g, "").length < 20 ||
    implementation.length < 12 ||
    !concreteAction.test(content) ||
    !concreteObject.test(content);
  return {
    ready: !vague,
    message: vague ? "核心技术方案较空泛，请补充具体实现步骤或连接关系。" : "",
  };
}

/** 保守校验：允许断句、排版和少量冗余动词整理，不允许改变技术描述。 */
export function isTechnicalSolutionPolish(original: string, candidate: string) {
  if (!original.trim() || !candidate.trim()) return false;
  const numbers = (text: string) =>
    (text.match(/[+-]?\s*\d+(?:\.\d+)?/g) || []).map((value) =>
      value.replace(/\s/g, ""),
    );
  if (JSON.stringify(numbers(original)) !== JSON.stringify(numbers(candidate)))
    return false;
  const normalize = (text: string) =>
    text
      .replace(/^\s*[-•]\s+/gm, "")
      .replace(
        /进行(?=采集|检测|计算|比较|判断|调节|控制|处理|存储|识别|传输)/g,
        "",
      )
      .replace(/[\s，。；、,:：;“”‘’"']/g, "");
  return normalize(original) === normalize(candidate);
}
