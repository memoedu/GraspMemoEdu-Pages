import {getLanguage} from './i18n.js?v=e4f0b61b1957cdae';

export function studentTopicGroups({request, learnerId, node, control}) {
  const tr=(zh,en)=>getLanguage()==='en'?en:zh;
  const box=node('details','studentFold');
  box.append(node('summary','',tr('课程分组与正文基线','Course groups and editable baselines')));
  const form=node('fieldset','profileForm'), status=node('p','profileStatus');
  status.setAttribute('role','status');
  box.append(form,status);
  const course=node('select'), group=node('select'), baseline=node('select'), name=node('input'), editable=node('input');
  name.maxLength=120; editable.type='checkbox';
  function field(label,input) {
    const element=node('label','courseHierarchySetting');
    element.append(document.createTextNode(label),input);
    form.append(element);
  }
  const option=(input,value,label)=>input.add(new Option(label,value));
  field(tr('课程','Course'),course); field(tr('分组','Group'),group); field(tr('组名','Group name'),name);
  field(tr('学习者可编辑个人正文','Allow learners to edit their own body'),editable);
  field(tr('分组底本','Group baseline'),baseline);
  option(baseline,'keep',tr('保留该组当前底本','Keep current group baseline'));
  option(baseline,'official',tr('课程官方底本','Official course baseline'));
  option(baseline,'mine',tr('我的当前课程版本','My current course version'));
  const member=node('p','inputHint');
  const save=control(tr('保存分组','Save group'),'secondaryButton',()=>act(saveGroup));
  const assign=control(tr('将此学员加入所选组','Assign learner to selected group'),'secondaryButton',()=>act(()=>assignGroup(group.value)));
  const remove=control(tr('恢复课程默认分组','Restore default for this learner'),'textButton',()=>act(()=>assignGroup(null)));
  form.append(member,save,assign,remove);
  let initialized=false, busy=false, groups=[], membership=null;
  function selectGroup() {
    const selected=groups.find(item=>item.group_id===group.value);
    name.value=selected?.name ?? ''; editable.checked=selected?.editable ?? true;
    baseline.value=selected?'keep':'official'; baseline.options[0].disabled=!selected;
    assign.disabled=!selected || selected.group_id===membership?.group_id;
    remove.disabled=!membership;
  }
  async function act(operation) {
    if(busy)return;
    busy=true; form.disabled=true; status.textContent='';
    try {await operation();}
    catch(error){status.textContent=error.message;}
    finally{busy=false;form.disabled=false;}
  }
  async function load(preferred) {
    const params=new URLSearchParams({course_id:course.value,learner_id:learnerId});
    const [list,assignment]=await Promise.all([request('topic-sync/groups',{fresh:true}),
      request('topic-sync/group-member?'+params,{fresh:true})]);
    groups=list.groups.filter(item=>item.course_id===course.value); membership=assignment.membership;
    group.replaceChildren();
    option(group,'',tr('新建分组','Create group'));
    for(const item of groups)option(group,item.group_id,item.name);
    group.value=groups.find(item=>item.group_id===(preferred ?? membership?.group_id))?.group_id ?? '';
    member.textContent=tr('学员当前分组　','Current group　')+(membership?.name ?? tr('课程默认','Course default'));
    selectGroup();
  }
  async function saveGroup() {
    const label=name.value.trim();
    if(!label){name.focus(); throw Error(tr('请填写组名。','Enter a group name.'));}
    const selected=groups.find(item=>item.group_id===group.value);
    let versions=baseline.value==='keep'?selected.baselines:{};
    if(baseline.value==='mine')versions=(await request('topic-sync/group-courses?'+new URLSearchParams({course_id:course.value}),{fresh:true})).baselines;
    const saved=await request('topic-sync/groups',{method:'POST',body:{course_id:course.value,
      group_id:selected?.group_id ?? crypto.randomUUID(), name:label,editable:editable.checked,
      expected_revision:selected?.revision ?? null,revision:crypto.randomUUID(),baselines:versions}});
    await load(saved.group_id);status.textContent=tr('分组已保存。','Group saved.');
  }
  async function assignGroup(id) {
    await request('topic-sync/group-member',{method:'POST',body:{learner_id:learnerId,course_id:course.value,
      group_id:id,expected_group_id:membership?.group_id ?? null}});
    await load(id);status.textContent=tr('学员分组已更新。','Learner assignment updated.');
  }
  course.onchange=()=>act(()=>load()); group.onchange=selectGroup;
  box.addEventListener('toggle',()=>{if(box.open&&!initialized)void act(async()=>{
    const {courses}=await request('topic-sync/group-courses',{fresh:true});
    course.replaceChildren();
    for(const item of courses)option(course,item.id,item.title);
    if(courses.length)await load();
    else {form.hidden=true;status.textContent=tr('没有可管理的课程。','No available courses.');}
    initialized=true;
  });});
  return box;
}
