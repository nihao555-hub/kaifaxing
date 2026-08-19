/** 背调和拿邮箱的唯一推荐顺序。不猜 Gmail，不批量搜人名。 */
import { extractRfqClues, rfqCorpus } from './researchPath.js';
import { isPersonLikeLead } from './research.js';
import { isAlibabaLead, isSellerUnlocked } from './alibabaIntel.js';
import { contactGap } from './contactLine.js';

export const PLAYBOOK_STEPS = [
  {
    key: 'identity',
    title: '先有法定名',
    detail: '政府招标、正文 Ltd、粘连显示名拆开、型号交叉检索。阿里昵称靠后台导出或补主体。',
  },
  {
    key: 'site',
    title: '先找官网和电话',
    detail: '黄页名录 + 公开登记库 + 搜索公式定位官网和电话。顺带制裁筛查。名录站本身不当官网。',
  },
  {
    key: 'email',
    title: '再收角色箱',
    detail: '官网 Impressum/联系页的 info@ / procurement@；没有明文才对已核域名做 SMTP。不猜 Gmail。',
  },
  {
    key: 'seller',
    title: '阿里拿邮箱',
    detail: '公开列表没有邮箱。国际站报价后导出 buyer_company_name / buyer_email，按询盘 ID 回填。',
  },
];

export function bestNext(customer = {}, { clues } = {}) {
  const found = clues || extractRfqClues(rfqCorpus(customer), customer);
  const person = isPersonLikeLead(customer);
  const grade = customer.research?.kyb?.grade || customer.research?.grade || '';
  const sanctions = customer.research?.kyb?.sanctions || [];
  const gap = contactGap(customer);

  if (sanctions.length || gap === 'stop') {
    return { key: 'stop', title: '制裁命中，停', next: '不要发开发信。换主体或丢掉这条。' };
  }
  if (isSellerUnlocked(customer) && customer.email) {
    return {
      key: 'kyb',
      title: '后台已解锁，核官网再发',
      next: '邮箱是买家报价时留下的。按法定名做工商和制裁，A 级再进开发信。',
    };
  }
  if (grade === 'A' && customer.email) {
    return { key: 'send', title: '可以写开发信', next: '主体、官网、角色箱都齐。按收件人时区发，不要改成私人邮箱。' };
  }
  if (gap === 'email' || (!person && (customer.website || found.websites[0]) && gap !== 'site')) {
    return {
      key: 'harvest',
      title: '挖官网角色箱',
      next: `官网已定位。从 ${customer.website || found.websites[0]} 联系页收 info@ / procurement@；没有明文再对这个域名做 SMTP，不猜 Gmail。`,
    };
  }
  if (gap === 'site' || (!person || customer.forceCompany || customer.regNo || found.companyHint)) {
    return {
      key: 'site',
      title: '找官网和电话',
      next: found.companyHint
        ? `已有「${found.companyHint}」。先走黄页和公开库找官网、电话，背调顺带做完；有官网再挖角色箱。`
        : '有公司全称。先走公开库、黄页名录和搜索公式找官网和电话，不要先撞 SMTP。',
    };
  }
  if (found.websites[0] || found.emails[0]) {
    return {
      key: 'clues',
      title: '先核正文里的官网',
      next: found.emails[0]
        ? `正文出现 ${found.emails[0]}，先确认域名是这家公司。`
        : `正文出现 ${found.websites[0]}，从联系页挖角色邮箱。`,
    };
  }
  if (gap === 'crosspost' || found.fingerprints.length) {
    return {
      key: 'crosspost',
      title: '用型号交叉检索',
      next: `不搜「${customer.company || customer.name}」。用 ${found.fingerprints.slice(0, 2).join(' / ') || '型号'} 找同款公开询盘是否写出公司名。`,
    };
  }
  if (gap === 'seller' || isAlibabaLead(customer)) {
    return {
      key: 'seller',
      title: '导入卖家后台导出',
      next: '公开列表没有邮箱。在国际站对这条报价后，导出 buyer_company_name / buyer_email，按询盘 ID 回填。这是拿邮箱的主路径。',
    };
  }
  return {
    key: 'identify',
    title: '手工补法定名',
    next: '没有可核验主体。填 Ltd/LLC 全称或登记号后再背调，不要猜私人邮箱。',
  };
}
