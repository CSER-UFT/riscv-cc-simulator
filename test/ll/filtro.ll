; ModuleID = 'filtro.c'
source_filename = "filtro.c"
target datalayout = "e-m:e-p:32:32-i64:64-n32-S128"
target triple = "riscv32-unknown-unknown"

@x = dso_local global [16 x float] [float 1.000000e+00, float 3.500000e+00, float 2.000000e+00, float 8.000000e+00, float 6.500000e+00, float 4.000000e+00, float 9.500000e+00, float 7.000000e+00, float 3.000000e+00, float 2.500000e+00, float 6.000000e+00, float 8.500000e+00, float 5.000000e+00, float 1.500000e+00, float 4.500000e+00, float 7.500000e+00], align 4
@y = dso_local global [16 x float] zeroinitializer, align 4

; Function Attrs: noinline nounwind optnone
define dso_local float @main() #0 {
  %1 = alloca i32, align 4
  %2 = alloca float, align 4
  %3 = alloca i32, align 4
  store i32 1, ptr %1, align 4
  br label %4

4:                                                ; preds = %24, %0
  %5 = load i32, ptr %1, align 4
  %6 = icmp slt i32 %5, 15
  br i1 %6, label %7, label %27

7:                                                ; preds = %4
  %8 = load i32, ptr %1, align 4
  %9 = sub nsw i32 %8, 1
  %10 = getelementptr inbounds [16 x float], ptr @x, i32 0, i32 %9
  %11 = load float, ptr %10, align 4
  %12 = load i32, ptr %1, align 4
  %13 = getelementptr inbounds [16 x float], ptr @x, i32 0, i32 %12
  %14 = load float, ptr %13, align 4
  %15 = fadd float %11, %14
  %16 = load i32, ptr %1, align 4
  %17 = add nsw i32 %16, 1
  %18 = getelementptr inbounds [16 x float], ptr @x, i32 0, i32 %17
  %19 = load float, ptr %18, align 4
  %20 = fadd float %15, %19
  %21 = fdiv float %20, 3.000000e+00
  %22 = load i32, ptr %1, align 4
  %23 = getelementptr inbounds [16 x float], ptr @y, i32 0, i32 %22
  store float %21, ptr %23, align 4
  br label %24

24:                                               ; preds = %7
  %25 = load i32, ptr %1, align 4
  %26 = add nsw i32 %25, 1
  store i32 %26, ptr %1, align 4
  br label %4, !llvm.loop !5

27:                                               ; preds = %4
  store float 0.000000e+00, ptr %2, align 4
  store i32 0, ptr %3, align 4
  br label %28

28:                                               ; preds = %37, %27
  %29 = load i32, ptr %3, align 4
  %30 = icmp slt i32 %29, 16
  br i1 %30, label %31, label %40

31:                                               ; preds = %28
  %32 = load i32, ptr %3, align 4
  %33 = getelementptr inbounds [16 x float], ptr @y, i32 0, i32 %32
  %34 = load float, ptr %33, align 4
  %35 = load float, ptr %2, align 4
  %36 = fadd float %35, %34
  store float %36, ptr %2, align 4
  br label %37

37:                                               ; preds = %31
  %38 = load i32, ptr %3, align 4
  %39 = add nsw i32 %38, 1
  store i32 %39, ptr %3, align 4
  br label %28, !llvm.loop !7

40:                                               ; preds = %28
  %41 = load float, ptr %2, align 4
  ret float %41
}

attributes #0 = { noinline nounwind optnone "frame-pointer"="all" "no-trapping-math"="true" "stack-protector-buffer-size"="8" "target-cpu"="generic-rv32" "target-features"="+32bit,+f,+m,+relax,+zicsr,-a,-c,-d,-e,-experimental-zacas,-experimental-zcmop,-experimental-zfbfmin,-experimental-zicfilp,-experimental-zicfiss,-experimental-zimop,-experimental-ztso,-experimental-zvfbfmin,-experimental-zvfbfwma,-h,-smaia,-smepmp,-ssaia,-svinval,-svnapot,-svpbmt,-v,-xcvalu,-xcvbi,-xcvbitmanip,-xcvelw,-xcvmac,-xcvmem,-xcvsimd,-xsfvcp,-xsfvfnrclipxfqf,-xsfvfwmaccqqq,-xsfvqmaccdod,-xsfvqmaccqoq,-xtheadba,-xtheadbb,-xtheadbs,-xtheadcmo,-xtheadcondmov,-xtheadfmemidx,-xtheadmac,-xtheadmemidx,-xtheadmempair,-xtheadsync,-xtheadvdot,-xventanacondops,-za128rs,-za64rs,-zawrs,-zba,-zbb,-zbc,-zbkb,-zbkc,-zbkx,-zbs,-zca,-zcb,-zcd,-zce,-zcf,-zcmp,-zcmt,-zdinx,-zfa,-zfh,-zfhmin,-zfinx,-zhinx,-zhinxmin,-zic64b,-zicbom,-zicbop,-zicboz,-ziccamoa,-ziccif,-zicclsm,-ziccrse,-zicntr,-zicond,-zifencei,-zihintntl,-zihintpause,-zihpm,-zk,-zkn,-zknd,-zkne,-zknh,-zkr,-zks,-zksed,-zksh,-zkt,-zmmul,-zvbb,-zvbc,-zve32f,-zve32x,-zve64d,-zve64f,-zve64x,-zvfh,-zvfhmin,-zvkb,-zvkg,-zvkn,-zvknc,-zvkned,-zvkng,-zvknha,-zvknhb,-zvks,-zvksc,-zvksed,-zvksg,-zvksh,-zvkt,-zvl1024b,-zvl128b,-zvl16384b,-zvl2048b,-zvl256b,-zvl32768b,-zvl32b,-zvl4096b,-zvl512b,-zvl64b,-zvl65536b,-zvl8192b" }

!llvm.module.flags = !{!0, !1, !2, !3}
!llvm.ident = !{!4}

!0 = !{i32 1, !"wchar_size", i32 4}
!1 = !{i32 1, !"target-abi", !"ilp32f"}
!2 = !{i32 7, !"frame-pointer", i32 2}
!3 = !{i32 8, !"SmallDataLimit", i32 8}
!4 = !{!"Ubuntu clang version 18.1.3 (1ubuntu1)"}
!5 = distinct !{!5, !6}
!6 = !{!"llvm.loop.mustprogress"}
!7 = distinct !{!7, !6}
