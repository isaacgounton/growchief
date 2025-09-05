import {
  createContext,
  type FC,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
} from "react";
import { FormProvider, useForm } from "react-hook-form";
import { classValidatorResolver } from "@hookform/resolvers/class-validator";
import { useInternalNode, useReactFlow } from "@xyflow/react";
import { Empty } from "@growchief/shared-both/dto/platforms/empty.dto.ts";
import { selectedEmitter } from "@growchief/frontend/components/workflows/workflow.node.wrapper.tsx";

const EmptyComponent: FC = () => {
  return <></>;
};

export const HighOrderContext = createContext<{
  settings: ReactElement | null;
  render: ReactElement | null;
  form: any;
}>({
  form: {} as any,
  settings: <EmptyComponent />,
  render: <EmptyComponent />,
});

export const useHighOrderNode = () => useContext(HighOrderContext);

export const refs = {} as Record<
  string,
  () => Promise<false | Record<string, any>>
>;
export const highOrderNode = (params: {
  dto?: any;
  identifier: string;
  settings?: FC;
  render?: FC;
}) => {
  const Component = ({ children, id }: { id: string; children: ReactNode }) => {
    const data = useInternalNode(id);
    const { fitView } = useReactFlow();
    const settings = data?.data?.settings || {};
    const form = useForm({
      resolver: classValidatorResolver(params.dto || Empty),
      ...(Object.keys(settings).length > 0 ? { values: { ...settings } } : {}),
      mode: "all",
      criteriaMode: "all",
      reValidateMode: "onChange",
    });

    const isValid = useCallback(() => {
      return form.trigger();
    }, []);

    const isValidAndFocus = useCallback(async () => {
      const valid = await isValid();
      if (!valid) {
        selectedEmitter.emit("selectNode", id);
        fitView({ padding: 0.2, duration: 1000, nodes: [data!] });
        return false;
      }
      return form.getValues();
    }, []);

    useEffect(() => {
      isValid();
      refs[id] ??= isValidAndFocus;

      return () => {
        delete refs[id];
      };
    }, []);

    const SettingsTop = params.settings;
    const RenderTop = params.render;

    return (
      <HighOrderContext
        value={{
          form,
          settings: SettingsTop ? (
            <FormProvider {...form}>
              <SettingsTop />
            </FormProvider>
          ) : null,
          render: RenderTop ? <RenderTop /> : null,
        }}
      >
        <FormProvider {...form}>{children}</FormProvider>
      </HighOrderContext>
    );
  };

  return {
    identifier: params.identifier,
    Component,
  };
};
