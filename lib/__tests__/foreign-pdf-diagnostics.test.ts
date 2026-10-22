import { describe,expect,it } from 'vitest';
import { foreignFailureDiagnostic } from '../../scripts/foreign-pdf/diagnostics.mjs';
describe('closed-enum native harness failure privacy (no native execution)',()=>{
  it('reports only exact production codes/kinds/status and fixed stages',()=>{
    expect(foreignFailureDiagnostic({code:'PDF_PROCESSING_UNAVAILABLE',status:503,message:'not emitted'},'positive-vector-text')).toEqual({event:'foreign-pdf-failure',stage:'positive-vector-text',code:'PDF_PROCESSING_UNAVAILABLE',kind:null,status:503});
    expect(foreignFailureDiagnostic({kind:'unsupported',message:'private report'},'source-precheck-vector-text')).toEqual({event:'foreign-pdf-failure',stage:'source-precheck-vector-text',code:'UNCLASSIFIED_FAILURE',kind:'unsupported',status:null});
    expect(foreignFailureDiagnostic({kind:'unavailable',status:503},'source-precheck-scan').kind).toBe('unavailable');
    expect(foreignFailureDiagnostic({code:'ERR_ASSERTION'},'archive-and-state-preservation').code).toBe('ERR_ASSERTION');
  });
  it.each([null,undefined,'secret document error',new Error('secret input'),{code:'PDF_XML_INVALID\nsecret-token',kind:'unsupported\nsecret-token',status:'503',message:'secret body',stdout:'secret report',stderr:'secret path'}])('does not serialize unknown errors, messages or child data',error=>{
    const output=JSON.stringify(foreignFailureDiagnostic(error,'/secret/private/input.pdf'));
    expect(output).not.toContain('secret');expect(output).toContain('unknown-stage');expect(output).toContain('UNCLASSIFIED_FAILURE');
  });
  it('never touches message/stack/output properties and tolerates throwing diagnostic getters',()=>{
    const error=Object.defineProperties({},Object.fromEntries(['message','stack','stdout','stderr','code','kind','status'].map(name=>[name,{get(){throw Error('secret getter');}}])));
    expect(()=>foreignFailureDiagnostic(error,'positive-vector-text')).not.toThrow();
    expect(foreignFailureDiagnostic(error,'positive-vector-text')).toEqual({event:'foreign-pdf-failure',stage:'positive-vector-text',code:'UNCLASSIFIED_FAILURE',kind:null,status:null});
  });
  it('rejects coercible diagnostic objects rather than running their conversion',()=>{
    const secret={toString(){throw Error('secret coercion');}};
    expect(foreignFailureDiagnostic({code:secret,kind:secret,status:secret},secret)).toEqual({event:'foreign-pdf-failure',stage:'unknown-stage',code:'UNCLASSIFIED_FAILURE',kind:null,status:null});
  });
});
