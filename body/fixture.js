// Demonstration records only; these are not a patient's clinical history.
export const fixture = {
  schema: 'kg/1',
  meta: { app: 'health', title: 'Personal health map', props: {
    sex: { type: 'enum', values: ['female', 'male'], default: 'male' }
  } },
  nodes: [
    ['heart','organ','Heart','heart','The centre of your cardiovascular neighbourhood.'],
    ['left-ventricle','part','Left ventricle','left-ventricle','The chamber that pumps blood to the body.'],
    ['right-atrium','part','Right atrium','right-atrium','The chamber that receives returning blood.'],
    ['aortic-valve','part','Aortic valve','aortic-valve','The valve between the left ventricle and aorta.'],
    ['hypertension','condition','Hypertension','heart','An example condition attached to the heart.'],
    ['ecg','analysis','ECG','ecg','Electrical activity · example investigation'],
    ['echo','analysis','Echocardiogram','heart','Ultrasound assessment · example investigation'],
    ['beta-blocker','protocol','Beta-blocker','capsule','Example protocol record; no treatment recommendation.'],
    ['cardiologist','specialist','Cardiologist','person','A specialist can connect findings across systems.'],
    ['retinopathy','condition','Retinopathy','eye','An example finding shared by an ophthalmologist.'],
  ].map(([id,type,label,mesh,description])=>({id,type,label,level:type==='organ'?0:1,weight:1,props:{mesh,description,demo:true}})),
  edges: [
    ['heart','left-ventricle','has-part'],['heart','right-atrium','has-part'],['heart','aortic-valve','has-part'],
    ['heart','hypertension','sign-of'],['heart','ecg','measured-by'],['heart','echo','measured-by'],
    ['heart','beta-blocker','treated-by'],['heart','cardiologist','reviewed-by'],
    ['hypertension','retinopathy','risk-from'],['eye-left','retinopathy','sign-of']
  ].map(([from,to,kind])=>({from,to,kind,power:1}))
};
