import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from "@langchain/openai";
import { CallbackHandler } from "@langfuse/langchain";

const langfuseHandler = new CallbackHandler();

const COMMON_PROBLEMS = `常见低级问题清单：

1. 描述不清，如写夹角为60°，却没确定基准平面
2. 图片中有不同颜色、编号的线条，却在文字中没有相应解释
3. 图片没有整体介绍是用来干什么的（只摆一张图，没有对图片进行定义）
4. 文字对图片的解释说明不到位，如文字中出现了abc，图片中没有
5. 对于现有技术中的描述过于宽泛，没有定位到具体技术问题，如“目前电动汽车普遍存在续航里程短的问题，用户充电不便，影响使用体验。“笼统的说明续航续航里程短。没有定位到具体的问题，到底是电池能量密度低？电驱效率差？热管理耗能高？还是能量回收不充分？
6. 对于存在缩写的提示发明人补充完全称以免发生歧义
7. 方案内容只有200字
8. 方案为对其他公司的软件/工具的改进
9. 机械类交底书里没有图，或只有数模截图没有黑白线框图；软件类交底书里没有流程图
10. 交底书内容主要是计算机代码
11. 交底书主要在进行如产品说明书般的功能描述，而缺乏实质性的技术改进
12.方案为设计一种管理规则流程
13. 方案主要为产品型号选购，例如：芯片长期被卡脖子，为实现芯片国产化，提出方案：芯片包括MCU、运放模块、驱动模块、通讯模块等部件。MCU选择XX公司XX型号，运放模块选用XX公司XX型号，驱动模块选用XX公司XX型号……
14. 方案为人工流程或者工位省略类型，例如：电芯维修工艺流程中，将模组组装工位与预组装工位合并或激光焊接与焊点质检工位合并
人工机械装配流程中有10个步骤，发现第7步其实没什么用，而去除掉这个工序
15. 方案为XX设备或者XX软件使用方法，例如：：选择数据，点击XX-点击XX-选择XX-点击生成，app根据以上操作生成图表
16. 方案为从人工改为机器操作，明显是现有技术，如：原检查车上VIN码等三码合一，是靠人工肉眼去看，现在改用摄像头拍摄，检测三码是否一致
`;

const PROBLEM_DETECTION_TEMPLATE_STRING = `你是一位专业的专利代理师，请根据以下信息对专利技术方案进行问题检测。

输入信息：
1. 技术方案：{technicalSolution}

常见低级问题清单：
{commonProblems}

检测要求：
1.文字检测： 仔细分析技术方案，识别其中存在的问题，仅限于常见低级问题清单中的问题
2.图片检测：对比图片介绍内容，判断是否与文字描述相符，是否有缺失或错误的地方
2. 每个问题分点输出，问题前必须标序号（如：1.、2.、3.）
3. 不要输出任何开场白、总结、提示语或其他无关内容
4. 只输出检测到的问题列表，每个问题占一行，问题前必须标序号（如：1.、2.、3.）
输出格式示例：
.技术方案描述不清晰，缺乏具体实现细节
.术方案与现有技术对比不充分
.技术方案的创新点不明确

请严格按照上述格式输出，不要包含任何其他文字。`;

const problemDetectionPromptTemplate = ChatPromptTemplate.fromTemplate(
  PROBLEM_DETECTION_TEMPLATE_STRING,
);

const model = new ChatOpenAI({
  modelName: process.env.OPENAI_CHAT_MODEL,
  temperature: 0.3,
  openAIApiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  timeout: 120000,
  maxRetries: 1,
  streaming: true,
});

const stringOutputParser = new StringOutputParser();

const problemDetectionChain = RunnableSequence.from([
  problemDetectionPromptTemplate,
  model,
  stringOutputParser,
]);

export async function streamProblemDetection(params: {
  technicalSolution: string;
}) {
  try {
    const stream = await problemDetectionChain.stream(
      {
        technicalSolution: params.technicalSolution,
        commonProblems: COMMON_PROBLEMS,
      },
      {
        callbacks: [langfuseHandler],
      },
    );
    return stream;
  } catch (error) {
    console.error("技术方案问题检测时发生错误:", error);
    throw new Error("技术方案问题检测失败");
  }
}

/** 供交底书工作流复用的非流式入口。 */
export async function detectDisclosureProblems(params: {
  technicalSolution: string;
}): Promise<string> {
  try {
    return String(
      await problemDetectionChain.invoke(
        {
          technicalSolution: params.technicalSolution,
          commonProblems: COMMON_PROBLEMS,
        },
        { callbacks: [langfuseHandler] },
      ),
    ).trim();
  } catch (error) {
    console.error("技术方案问题检测时发生错误:", error);
    throw new Error("技术方案问题检测失败");
  }
}

export { problemDetectionChain };
